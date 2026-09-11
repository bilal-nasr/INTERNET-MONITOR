import { db } from "@/lib/db";
import { sendQuotaAlert } from "@/lib/email";
import { quotaBytes } from "@/lib/format";
import type { SettingsRow } from "@/lib/settings";
import { isWithinWindow, localParts, toHHMM } from "@/lib/time";
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

/**
 * Store one counter sample from the router and apply the daily quota window
 * logic. Readings only ever arrive by push, from the router's own script
 * posting to /api/ingest.
 */
export async function recordReading(
  settings: SettingsRow,
  counters: WanCounters,
  now = new Date(),
  sessionKey: string | null = null,
): Promise<RecordedResult> {
  // Store the reading. Compare against the previous one to detect a reboot.
  const previous = await getLatestReading();
  const reading = await db.one<Reading>(
    `INSERT INTO interface_readings (recorded_at, tx_bytes, rx_bytes, session_key)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [now, counters.txBytes, counters.rxBytes, sessionKey],
  );

  // Router reboot: counters reset, so the new total is lower than before.
  // Nothing to "fix" here; sumUsageSince() never computes a negative delta and
  // the post-reboot reading simply becomes the new reference point.
  const rebooted = previous !== null && reading.total_bytes < previous.total_bytes;

  const local = localParts(reading.recorded_at, settings.timezone);
  const windowActive = isWithinWindow(local.minutes, settings.window_start, settings.window_end);

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

  // First reading inside today's window becomes the baseline.
  let window = await getDailyWindow(local.date);
  let baselineCreated = false;
  if (!window) {
    window = await db.one(
      `INSERT INTO daily_windows (window_date, baseline_bytes, baseline_recorded_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (window_date) DO UPDATE SET window_date = EXCLUDED.window_date
       RETURNING *`,
      [local.date, reading.total_bytes, reading.recorded_at],
    );
    baselineCreated = true;
  }

  // Usage since baseline. Summing consecutive deltas equals
  // current_total - baseline_bytes when no reboot happened, and falls back to
  // the post-reboot accumulated readings when one did.
  const used = await sumUsageSince(window!.baseline_recorded_at);
  const quota = quotaBytes(settings.quota_gb);
  const exceeded = used > quota;

  // Alert once per day.
  let alertSent = false;
  if (exceeded && !window!.notified) {
    if (!settings.alert_email_to) {
      throw new Error("Quota exceeded but alert_email_to is not set in /settings");
    }
    await sendQuotaAlert({
      to: settings.alert_email_to,
      date: local.date,
      usedBytes: used,
      quotaBytes: quota,
      windowStart: base.window.start,
      windowEnd: base.window.end,
      timezone: settings.timezone,
    });
    await db.none("UPDATE daily_windows SET notified = true WHERE id = $1", [window!.id]);
    alertSent = true;
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
