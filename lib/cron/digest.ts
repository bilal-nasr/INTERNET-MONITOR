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
 *
 * This job's own job_runs row backs that memory up for the one case the alerts
 * log cannot cover: a digest that was mailed but whose row was never written.
 */

import { dispatchAlert } from "@/lib/alerts/dispatch";
import { latestAlert, type AlertStatus } from "@/lib/alerts/log";
import { effectiveLastSentAt } from "@/lib/cron/digest-decision";
import { registerJob, type Job, type JobContext, type JobResult } from "@/lib/cron/jobs";
import { getJobRun } from "@/lib/cron/runs";
import { digestDueAt, digestReportDate, isDigestDue } from "@/lib/cron/schedule";
import { buildAlertReport, minimalAlertReport, type AlertReportInput } from "@/lib/email-report";
import { renderAlertEmail } from "@/lib/email-template";
import { quotaBytes } from "@/lib/format";
import { getComplianceDays } from "@/lib/stats";
import { localTimeInstant } from "@/lib/time";

const JOB_NAME = "digest";

/**
 * What the tick writes into job_runs.last_detail for one attempt. Produced and
 * recognised through the same function so the two spellings cannot drift; the
 * date in it names the period the attempt was for.
 */
function detailFor(status: AlertStatus, date: string): string {
  return `digest ${status} for ${date}`;
}

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
  const lastSentAt = effectiveLastSentAt(last, now);

  if (!isDigestDue(settings.digest, now, lastSentAt, settings.billing_cycle_day, settings.timezone)) {
    // isDigestDue only returns false here when lastSentAt is non-null: digest
    // is not "off" at this point, so due is always a real instant, and a null
    // lastSentAt makes isDigestDue return true unconditionally.
    return { status: "skipped", detail: `last sent ${lastSentAt!.toISOString()}` };
  }

  const dueAt = digestDueAt(settings.digest, now, settings.billing_cycle_day, settings.timezone) ?? now;
  const { date, asOf } = digestReportDate(settings.digest, dueAt, settings.billing_cycle_day, settings.timezone);

  // Secondary guard, behind the alerts log above, and checked before the five
  // aggregates below so a duplicate costs nothing.
  //
  // dispatchAlert returns {status: "sent", row: null} when the mail went out
  // but the `alerts` INSERT recording it failed - correct for callers whose
  // claim lives elsewhere, but here that lost row IS the memory of the send,
  // so the next tick would find nothing and mail the same report again, every
  // five minutes, for as long as the insert keeps failing. job_runs is a
  // different table, written by the tick after this job returns, so it still
  // stands in exactly that case. The recorded detail names the period's date,
  // so it only silences the period it was written for; a `failed` or `skipped`
  // attempt is not a send and never matches, which keeps the retry behaviour
  // lib/cron/digest-decision.ts documents.
  const lastRun = await getJobRun(JOB_NAME);
  if (lastRun && lastRun.last_detail === detailFor("sent", date) && lastRun.last_run_at >= dueAt) {
    return { status: "skipped", detail: `already sent for ${date} (job_runs)` };
  }

  // The report is measured one millisecond BEFORE `asOf`, not at it. `asOf` is
  // local midnight on the due day, which for the cycle digest is the cycle
  // boundary itself: getCycleUsage would read it as the first instant of the
  // cycle that just opened and the mail would say "0.00 GB of 600.00 GB (0%),
  // day 0 of 30" under a "Billing cycle report" subject. A millisecond earlier
  // lands inside the cycle that just closed, with its full usage. For the
  // weekly digest the two instants are a millisecond apart in the middle of a
  // cycle and on the far side of the reported day's window, so it changes
  // nothing there.
  const reportAt = new Date(asOf.getTime() - 1);

  const usedBytes = await windowUsageOn(date, ctx);
  const input: AlertReportInput = {
    settings,
    kind: "digest",
    digest: settings.digest,
    date,
    usedBytes,
    quotaBytes: quotaBytes(settings.quota_gb),
    threshold: null,
    now: reportAt,
    // The cycle digest reports a cycle that has just closed, so the cycle
    // figures are evaluated at the boundary rather than a millisecond short of
    // it: "day 31 of 31", nothing remaining, and a daily average divided by
    // every day of the month. The weekly digest is measured mid-cycle and asks
    // the live question like everything else.
    atCycleEnd: settings.digest === "cycle",
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

  return { status: status === "failed" ? "failed" : "ok", detail: detailFor(status, date) };
}

export const digestJob: Job = { name: "digest", run };

registerJob(digestJob);
