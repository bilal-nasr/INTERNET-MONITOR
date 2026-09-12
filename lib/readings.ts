import { dispatchAlert, inFailureCooldown } from "@/lib/alerts/dispatch";
import { nextThreshold } from "@/lib/alerts/thresholds";
import { db } from "@/lib/db";
import { renderAlertEmail } from "@/lib/email-template";
import { buildAlertReport, minimalAlertReport } from "@/lib/email-report";
import { quotaBytes } from "@/lib/format";
import type { SettingsRow } from "@/lib/settings";
import { isWithinWindow, localParts, localTimeInstant, toHHMM } from "@/lib/time";
import { getDailyWindow, getLatestReading, sumUsageSince, type Reading } from "@/lib/usage";

export interface WanCounters {
  name: string;
  txBytes: number;
  rxBytes: number;
  running: boolean;
  disabled: boolean;
}

export interface RecordedResult {
  status: "ok";
  reading: { id: number; recorded_at: string; tx_bytes: number; rx_bytes: number; total_bytes: number };
  interface: { name: string; running: boolean; disabled: boolean };
  rebooted: boolean;
  local: { date: string; time: string; timezone: string };
  window: { start: string; end: string; active: boolean };
  quota: null | {
    baseline_bytes: number;
    baseline_created: boolean;
    used_since_baseline: number;
    quota_bytes: number;
    exceeded: boolean;
    alert_sent: boolean;
    already_notified: boolean;
    notified_level: number;
  };
}

export interface StoredReading {
  reading: Reading;
  rebooted: boolean;
  local: { date: string; time: string; timezone: string };
  windowActive: boolean;
}

/**
 * Store one counter sample. Kept separate from, and run before, everything
 * else: the raw reading is the one fact that cannot be reconstructed later,
 * whereas session state and the quota total are both derived and self-heal on
 * the next push.
 */
export async function storeReading(
  settings: SettingsRow,
  counters: WanCounters,
  now = new Date(),
  sessionKey: string | null = null,
): Promise<StoredReading> {
  const previous = await getLatestReading();
  const reading = await db.one<Reading>(
    `INSERT INTO interface_readings (recorded_at, tx_bytes, rx_bytes, session_key, interface_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [now, counters.txBytes, counters.rxBytes, sessionKey, counters.name],
  );
  const rebooted = previous !== null && reading.total_bytes < previous.total_bytes;
  const local = localParts(reading.recorded_at, settings.timezone);
  return {
    reading,
    rebooted,
    local: { date: local.date, time: local.time, timezone: settings.timezone },
    windowActive: isWithinWindow(local.minutes, settings.window_start, settings.window_end),
  };
}

/**
 * Give a claimed mark back. Only this call's own claim is undone: a concurrent
 * push may already have claimed and sent a higher mark since this one failed,
 * and writing the old value back unconditionally would clobber that claim and
 * let the same mark be mailed again later. `notified` is kept in step with
 * `notified_level` whatever value this writes.
 */
function releaseDailyClaim(windowId: number, level: number, prev: number): Promise<null> {
  return db.none(
    `UPDATE daily_windows SET notified_level = $3, notified = ($3 >= 100)
     WHERE id = $1 AND notified_level = $2`,
    [windowId, level, prev],
  );
}

/**
 * Apply the daily quota window to an already-stored reading: create today's
 * baseline if needed, total the usage since it, and send the one alert.
 */
export async function recordReading(
  settings: SettingsRow,
  counters: WanCounters,
  now = new Date(),
  sessionKey: string | null = null,
  stored: StoredReading | null = null,
): Promise<RecordedResult> {
  const s = stored ?? (await storeReading(settings, counters, now, sessionKey));
  const { reading, rebooted, windowActive } = s;
  const local = s.local;

  const base = {
    status: "ok" as const,
    reading: {
      id: reading.id,
      recorded_at: reading.recorded_at.toISOString(),
      tx_bytes: reading.tx_bytes,
      rx_bytes: reading.rx_bytes,
      total_bytes: reading.total_bytes,
    },
    interface: { name: counters.name, running: counters.running, disabled: counters.disabled },
    rebooted,
    local: { date: local.date, time: local.time, timezone: settings.timezone },
    window: {
      start: toHHMM(settings.window_start),
      end: toHHMM(settings.window_end),
      active: windowActive,
    },
  };

  // Outside the window: just log readings.
  if (!windowActive) {
    return { ...base, quota: null };
  }

  // The baseline is the last reading at or before the window opened, so that
  // traffic is still counted when the app missed the start of the window. Only
  // when there is no such reading does the current one become the baseline.
  let window = await getDailyWindow(local.date);
  let baselineCreated = false;
  if (!window) {
    const windowStart = localTimeInstant(local.date, settings.window_start, settings.timezone);
    const before = windowStart
      ? await db.oneOrNone<Reading>(
          `SELECT * FROM interface_readings
           WHERE recorded_at <= $1::timestamptz
             AND recorded_at >= $1::timestamptz - INTERVAL '1 day'
             AND interface_name IS NOT DISTINCT FROM $2
           ORDER BY recorded_at DESC, id DESC LIMIT 1`,
          [windowStart, counters.name],
        )
      : null;
    const anchor = before ?? reading;
    window = await db.one(
      `INSERT INTO daily_windows (window_date, baseline_bytes, baseline_recorded_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (window_date) DO UPDATE SET window_date = EXCLUDED.window_date
       RETURNING *`,
      [local.date, anchor.total_bytes, anchor.recorded_at],
    );
    baselineCreated = true;
  }

  // Usage since baseline. Summing consecutive deltas equals
  // current_total - baseline_bytes when no reboot happened, and falls back to
  // the post-reboot accumulated readings when one did.
  const windowEnd = localTimeInstant(local.date, settings.window_end, settings.timezone, 1);
  const used = await sumUsageSince(window!.baseline_recorded_at, windowEnd);
  const quota = quotaBytes(settings.quota_gb);
  const exceeded = used > quota;
  const percent = quota > 0 ? (used / quota) * 100 : 0;

  // One mail per mark per day. The mark is claimed with a conditional update
  // before anything is sent, so two readings arriving at once cannot both send
  // it. A failed send releases the claim, and a later reading tries again once
  // the failure cooldown has passed.
  // A missing address keeps the claim: the row in `alerts` says it was skipped,
  // and there is no point re-deciding that on every push for the rest of the day.
  let alertSent = false;
  let notifiedLevel = window!.notified_level;
  const level = nextThreshold(percent, notifiedLevel, settings.alert_thresholds);
  // Claimed but not yet resolved: set between the claim and the send, cleared
  // once the outcome is known, so the catch below knows a claim is outstanding.
  let claimedPrev: number | null = null;
  try {
    if (level !== null) {
      const kind = level >= 100 ? ("daily_exceeded" as const) : ("daily_threshold" as const);
      // Mail that is failing stays failing: skip the whole rebuild-and-send
      // while the newest attempt for this kind and day is a recent failure.
      // Nothing is claimed, so a push after the cooldown tries the mark again.
      const coolingDown = await inFailureCooldown(kind, local.date, now);
      if (!coolingDown) {
        // Claim the mark and read the value it replaces in the same statement.
        // The FOR UPDATE sub-select locks the row first, so `prev` is the value
        // this update actually overwrote, not the one read several round trips
        // ago at the top of this function - a concurrent push may have claimed
        // and mailed a mark in between, and releasing to the stale value would
        // let that mark be mailed a second time.
        const claimed = await db.oneOrNone<{ prev: number }>(
          `UPDATE daily_windows d SET notified_level = $2, notified = ($2 >= 100)
           FROM (SELECT notified_level AS prev FROM daily_windows WHERE id = $1 FOR UPDATE) p
           WHERE d.id = $1 AND d.notified_level < $2
           RETURNING p.prev`,
          [window!.id, level],
        );
        if (claimed) {
          claimedPrev = claimed.prev;
          // The extra aggregates run once per mark, never on the pushes either
          // side of it. If any of them fail the mail still goes out with the
          // headline.
          const figures = {
            settings,
            kind: "alert" as const,
            date: local.date,
            usedBytes: used,
            quotaBytes: quota,
            threshold: level,
            now,
          };
          const report = await buildAlertReport(figures).catch((err) => {
            console.warn("[readings] could not build the full alert report", err);
            return minimalAlertReport(figures);
          });
          const result = await dispatchAlert({
            kind,
            level,
            scopeKey: local.date,
            to: settings.alert_email_to,
            email: renderAlertEmail(report),
            payload: { used_bytes: used, quota_bytes: quota, percent: Math.round(percent * 10) / 10 },
          });
          if (result.status === "failed") {
            await releaseDailyClaim(window!.id, level, claimed.prev);
          } else {
            notifiedLevel = level;
            alertSent = result.status === "sent";
          }
          claimedPrev = null;
        }
      }
    }
  } catch (err) {
    // The reading is already stored and is about to be answered for; alerting
    // must never turn that into a failed push. dispatchAlert throws when the
    // `alerts` insert itself fails, and the statements around it throw when the
    // database is unwell. Release an outstanding claim so the mark is not lost.
    console.error("[readings] alerting failed", err);
    if (level !== null && claimedPrev !== null) {
      await releaseDailyClaim(window!.id, level, claimedPrev).catch((releaseErr) => {
        console.error("[readings] could not release the alert claim", releaseErr);
      });
    }
  }

  return {
    ...base,
    quota: {
      baseline_bytes: window!.baseline_bytes,
      baseline_created: baselineCreated,
      used_since_baseline: used,
      quota_bytes: quota,
      exceeded,
      alert_sent: alertSent,
      already_notified: notifiedLevel >= 100,
      notified_level: notifiedLevel,
    },
  };
}
