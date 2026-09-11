import { db } from "@/lib/db";
import { sendAlertEmail } from "@/lib/email";
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

  // Alert once per day. The flag is claimed with a conditional update before
  // the email is sent, so two readings arriving at once cannot both send it.
  // If the send then fails the claim is released, leaving the next reading to
  // retry exactly as before.
  let alertSent = false;
  if (exceeded && !window!.notified && !settings.alert_email_to) {
    // Recording the reading still succeeded, so failing the request here would
    // only make the router log an error on every push for the rest of the day.
    console.warn("[readings] quota exceeded but alert_email_to is not set in /settings");
  } else if (exceeded && !window!.notified) {
    const claimed = await db.oneOrNone<{ id: number }>(
      "UPDATE daily_windows SET notified = true WHERE id = $1 AND notified = false RETURNING id",
      [window!.id],
    );
    if (claimed) {
      try {
        // The extra aggregates run once a day, on the one push that trips the
        // quota, and never on the pushes either side of it. If any of them
        // fail the alert still goes out carrying the figures already in hand.
        const figures = {
          settings,
          kind: "alert" as const,
          date: local.date,
          usedBytes: used,
          quotaBytes: quota,
          now,
        };
        const report = await buildAlertReport(figures).catch((err) => {
          console.warn("[readings] could not build the full alert report", err);
          return minimalAlertReport(figures);
        });
        await sendAlertEmail(settings.alert_email_to!, report);
        alertSent = true;
      } catch (err) {
        await db.none("UPDATE daily_windows SET notified = false WHERE id = $1", [window!.id]);
        throw err;
      }
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
      already_notified: window!.notified,
    },
  };
}
