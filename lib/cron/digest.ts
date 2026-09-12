/**
 * The scheduled summary: the quota alert's report, sent on a calendar rather
 * than by a breach. Weekly on Monday morning about the week just ended, or on
 * the first morning of a billing cycle about the cycle just closed.
 *
 * The alerts log is the memory of what was sent: the newest digest row's
 * created_at is what isDigestDue compares against - but only when that row
 * actually reached "sent". A `failed` row (mail provider misconfigured) would
 * otherwise silence every digest for the rest of the period, since the next
 * scheduled instant is up to a week - or a whole billing cycle - away; it only
 * counts as "already sent" for FAILED_SEND_COOLDOWN_MS, the same cooldown
 * lib/cron/stale.ts uses via inFailureCooldown, so a fixed API key is retried
 * within minutes rather than at the next period. A `skipped` row (no
 * recipient configured) never counts as sent at all: nothing went out, so
 * every tick is free to try again the moment a recipient is configured.
 */

import { dispatchAlert, FAILED_SEND_COOLDOWN_MS } from "@/lib/alerts/dispatch";
import { latestAlert } from "@/lib/alerts/log";
import { registerJob, type Job, type JobContext, type JobResult } from "@/lib/cron/jobs";
import { digestDueAt, digestReportDate, isDigestDue } from "@/lib/cron/schedule";
import { buildAlertReport, minimalAlertReport, type AlertReportInput } from "@/lib/email-report";
import { renderAlertEmail } from "@/lib/email-template";
import { quotaBytes } from "@/lib/format";
import { getComplianceDays } from "@/lib/stats";
import { localTimeInstant } from "@/lib/time";

/** Traffic inside the quota window on one local date. */
async function windowUsageOn(date: string, ctx: JobContext): Promise<number> {
  const { settings } = ctx;
  const from = localTimeInstant(date, "00:00", settings.timezone);
  const to = localTimeInstant(date, "00:00", settings.timezone, 1440);
  if (!from || !to) return 0;
  const days = await getComplianceDays({ from, to }, settings.timezone, settings.window_start, settings.window_end);
  return days.find((row) => row.day === date)?.used_bytes ?? 0;
}

async function run(ctx: JobContext): Promise<JobResult> {
  const { now, settings } = ctx;
  if (settings.digest === "off") return { status: "skipped", detail: "digest is off" };

  const last = await latestAlert("digest");
  // Only a row that actually sent - or a failed one still within its cooldown
  // - counts as "already handled" for this period. A skipped row (no
  // recipient) never blocks; a failed row older than the cooldown no longer
  // blocks either, so a fixed misconfiguration is retried on the next tick
  // instead of staying silent until the next scheduled instant.
  const inFailureCooldown =
    last?.status === "failed" && now.getTime() - last.created_at.getTime() < FAILED_SEND_COOLDOWN_MS;
  const lastSentAt = last && (last.status === "sent" || inFailureCooldown) ? last.created_at : null;

  if (!isDigestDue(settings.digest, now, lastSentAt, settings.billing_cycle_day, settings.timezone)) {
    return { status: "skipped", detail: lastSentAt ? `last sent ${lastSentAt.toISOString()}` : "not due" };
  }

  const dueAt = digestDueAt(settings.digest, now, settings.billing_cycle_day, settings.timezone) ?? now;
  const { date, asOf } = digestReportDate(settings.digest, dueAt, settings.billing_cycle_day, settings.timezone);

  const usedBytes = await windowUsageOn(date, ctx);
  const input: AlertReportInput = {
    settings,
    kind: "digest",
    digest: settings.digest,
    date,
    usedBytes,
    quotaBytes: quotaBytes(settings.quota_gb),
    threshold: null,
    now: asOf,
  };
  const report = await buildAlertReport(input).catch((err) => {
    console.warn("[cron] digest: could not build the full report", err);
    return minimalAlertReport(input);
  });

  const { status } = await dispatchAlert({
    kind: "digest",
    level: null,
    scopeKey: `digest:${date}`,
    to: settings.alert_email_to,
    email: renderAlertEmail(report),
    payload: { digest: settings.digest, date, today: report.today, cycle: report.cycle, week: report.week },
  });

  return { status: status === "failed" ? "failed" : "ok", detail: `digest ${status} for ${date}` };
}

export const digestJob: Job = { name: "digest", run };

registerJob(digestJob);
