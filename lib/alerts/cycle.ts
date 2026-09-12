import { dispatchAlert } from "@/lib/alerts/dispatch";
import type { AlertKind } from "@/lib/alerts/log";
import { paceCrossesCap } from "@/lib/alerts/pace";
import { nextThreshold } from "@/lib/alerts/thresholds";
import { db } from "@/lib/db";
import { renderCycleEmail, type CycleReport } from "@/lib/email-cycle-template";
import { alertLocale, type SettingsRow } from "@/lib/settings";
import { getCycleUsage, type CycleUsage } from "@/lib/stats";
import { localParts } from "@/lib/time";

/**
 * The monthly-cap alerts. Runs from the ingest path, so it is throttled: the
 * cycle total is one aggregate over the whole cycle, and thirty seconds of
 * traffic cannot move it far enough to matter. State is per process; a second
 * instance simply checks on its own clock, and the conditional updates below
 * keep the two from both mailing.
 */
const CHECK_EVERY_MS = 5 * 60_000;
let lastCheckedAt = 0;

export interface CycleCheck {
  status: "checked" | "throttled" | "failed";
  sent: AlertKind[];
  detail?: string;
}

interface CycleAlertRow {
  cycle_start: string;
  notified_level: number;
  pace_notified: boolean;
}

function appUrl(): string | null {
  const raw = process.env.APP_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

function toReport(kind: CycleReport["kind"], threshold: number | null, settings: SettingsRow, cycle: CycleUsage, now: Date): CycleReport {
  return {
    kind,
    locale: alertLocale(settings),
    generated_at: now.toISOString(),
    timezone: settings.timezone,
    threshold,
    app_url: appUrl(),
    cycle: {
      start: localParts(new Date(cycle.start), settings.timezone).date,
      end: localParts(new Date(cycle.end), settings.timezone).date,
      used_bytes: cycle.used_bytes,
      cap_bytes: cycle.cap_bytes,
      percent: cycle.percent_of_cap,
      projected_bytes: cycle.projected_bytes,
      projected_percent: cycle.projected_percent,
      days_elapsed: cycle.days_elapsed,
      days_total: cycle.days_total,
      days_remaining: cycle.days_remaining,
      daily_budget_bytes: cycle.daily_budget_bytes,
      daily_average_bytes: cycle.daily_average_bytes,
      over: cycle.over,
    },
  };
}

export async function checkCycleAlerts(settings: SettingsRow, now = new Date()): Promise<CycleCheck> {
  if (now.getTime() - lastCheckedAt < CHECK_EVERY_MS) return { status: "throttled", sent: [] };
  lastCheckedAt = now.getTime();

  const sent: AlertKind[] = [];
  try {
    const cycle = await getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone, now);
    const cycleStart = localParts(new Date(cycle.start), settings.timezone).date;

    const state = await db.one<CycleAlertRow>(
      `INSERT INTO cycle_alerts (cycle_start) VALUES ($1)
       ON CONFLICT (cycle_start) DO UPDATE SET updated_at = now()
       RETURNING cycle_start::text, notified_level, pace_notified`,
      [cycleStart],
    );

    const level = nextThreshold(cycle.percent_of_cap, state.notified_level, settings.cycle_alert_thresholds);
    if (level !== null) {
      const claimed = await db.oneOrNone(
        `UPDATE cycle_alerts SET notified_level = $2, updated_at = now()
         WHERE cycle_start = $1 AND notified_level < $2 RETURNING cycle_start`,
        [cycleStart, level],
      );
      if (claimed) {
        const result = await dispatchAlert({
          kind: "cycle_threshold",
          level,
          scopeKey: cycleStart,
          to: settings.alert_email_to,
          email: renderCycleEmail(toReport("threshold", level, settings, cycle, now)),
          payload: { used_bytes: cycle.used_bytes, cap_bytes: cycle.cap_bytes, percent: cycle.percent_of_cap },
        });
        if (result.status === "failed") {
          // Only undo this call's own claim. A concurrent instance may already
          // have claimed and sent a higher mark since this claim failed;
          // writing back the old value unconditionally would clobber that
          // claim and let the same mark be mailed again later.
          await db.none(
            `UPDATE cycle_alerts SET notified_level = $3 WHERE cycle_start = $1 AND notified_level = $2`,
            [cycleStart, level, state.notified_level],
          );
        } else if (result.status === "sent") {
          sent.push("cycle_threshold");
        }
      }
    }

    if (settings.cycle_pace_alert && !state.pace_notified && paceCrossesCap(cycle)) {
      const claimed = await db.oneOrNone(
        `UPDATE cycle_alerts SET pace_notified = true, updated_at = now()
         WHERE cycle_start = $1 AND pace_notified = false RETURNING cycle_start`,
        [cycleStart],
      );
      if (claimed) {
        const result = await dispatchAlert({
          kind: "cycle_pace",
          level: null,
          scopeKey: cycleStart,
          to: settings.alert_email_to,
          email: renderCycleEmail(toReport("pace", null, settings, cycle, now)),
          payload: { projected_bytes: cycle.projected_bytes, cap_bytes: cycle.cap_bytes, days_elapsed: cycle.days_elapsed },
        });
        if (result.status === "failed") {
          // Only undo this call's own claim: guard on the flag still being
          // true so a release can never clear a flag some other successful
          // claim set. Only the claiming call can set it true, so today this
          // is unreachable, but it is guarded anyway for consistency with
          // the threshold release above.
          await db.none("UPDATE cycle_alerts SET pace_notified = false WHERE cycle_start = $1 AND pace_notified = true", [cycleStart]);
        } else if (result.status === "sent") {
          sent.push("cycle_pace");
        }
      }
    }

    return { status: "checked", sent };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[alerts] cycle check failed:", detail);
    return { status: "failed", sent, detail };
  }
}
