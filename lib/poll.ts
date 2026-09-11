import { db } from "@/lib/db";
import { sendQuotaAlert } from "@/lib/email";
import { quotaBytes } from "@/lib/format";
import { fetchWanCounters, RouterError, type WanCounters } from "@/lib/router";
import { getSettings, type SettingsRow } from "@/lib/settings";
import { isWithinWindow, localParts, toHHMM } from "@/lib/time";
import { getDailyWindow, getLatestReading, getReadingsSince, sumUsage, type Reading } from "@/lib/usage";

export type ReadingSource = "pull" | "push";

export interface RecordedResult {
  status: "ok";
  source: ReadingSource;
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

export type PollResult = { status: "paused"; message: string } | RecordedResult;

/**
 * Pull mode: read config from the settings table, sample the router's REST
 * API, then store the reading and apply the quota logic.
 */
export async function runPoll(now = new Date()): Promise<PollResult> {
  const settings = await getSettings();

  // Pause switch: no reading, no DB write.
  if (!settings.polling_enabled) {
    return { status: "paused", message: "polling_enabled is false; nothing was recorded" };
  }

  if (!settings.router_host || !settings.router_user || !settings.router_pass) {
    throw new RouterError(
      "Router host, user and password must all be set in /settings for pull mode " +
        "(or let the router push readings to /api/ingest instead)",
    );
  }

  const counters = await fetchWanCounters({
    host: settings.router_host,
    user: settings.router_user,
    pass: settings.router_pass,
    wanInterfaceName: settings.wan_interface_name,
  });

  return recordReading(settings, counters, "pull", now);
}

/**
 * Shared by pull mode (runPoll) and push mode (/api/ingest): store one counter
 * sample and apply the daily quota window logic.
 */
export async function recordReading(
  settings: SettingsRow,
  counters: WanCounters,
  source: ReadingSource,
  now = new Date(),
): Promise<RecordedResult> {
  // Store the reading. Compare against the previous one to detect a reboot.
  const previous = await getLatestReading();
  const reading = await db.one<Reading>(
    `INSERT INTO interface_readings (recorded_at, tx_bytes, rx_bytes)
     VALUES ($1, $2, $3) RETURNING *`,
    [now, counters.txBytes, counters.rxBytes],
  );

  // Router reboot: counters reset, so the new total is lower than before.
  // Nothing to "fix" here; sumUsage() never computes a negative delta and the
  // post-reboot reading simply becomes the new reference point.
  const rebooted = previous !== null && reading.total_bytes < previous.total_bytes;

  const local = localParts(reading.recorded_at, settings.timezone);
  const windowActive = isWithinWindow(local.minutes, settings.window_start, settings.window_end);

  const base = {
    status: "ok" as const,
    source,
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
  const sinceBaseline = await getReadingsSince(window!.baseline_recorded_at);
  const used = sumUsage(sinceBaseline);
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
