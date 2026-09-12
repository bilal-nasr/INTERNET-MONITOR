/**
 * "The router has gone quiet."
 *
 * Nothing runs when the router stops pushing, which is exactly why this check
 * cannot live on the ingest path and has to be driven by the tick. It sends
 * one mail when the silence passes the limit and one more when readings
 * resume. The alerts log is the state: the newest link_* rows say whether an
 * outage is currently being reported - see lib/cron/stale-decision.ts for the
 * pure branch-selection logic (unit-tested there without a database). This
 * job's own job_runs row backs that state up for the one case where the log
 * cannot: a mail that went out but whose `alerts` row was never written.
 *
 * It stays silent while monitoring is paused: the ingest route drops readings
 * then, so the silence is the user's own doing and not an outage.
 */

import { dispatchAlert } from "@/lib/alerts/dispatch";
import { latestAlert, type AlertStatus } from "@/lib/alerts/log";
import { registerJob, type Job, type JobContext, type JobResult } from "@/lib/cron/jobs";
import { getJobRun } from "@/lib/cron/runs";
import { isStale } from "@/lib/cron/schedule";
import { decideStaleAction } from "@/lib/cron/stale-decision";
import { renderLinkEmail } from "@/lib/email-link-template";
import { findSilenceStartingAt } from "@/lib/outage-cause-store";
import { alertLocale } from "@/lib/settings";
import { getLatestReading } from "@/lib/usage";

const SCOPE = "link";
const JOB_NAME = "stale";

/**
 * What the tick writes into job_runs.last_detail for one attempt. Produced and
 * recognised through the same function so the two spellings cannot drift.
 */
function detailFor(kind: "link_stale" | "link_recovered", status: AlertStatus): string {
  return `${kind} ${status}`;
}

function appUrl(): string | null {
  const raw = process.env.APP_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

async function run({ now, settings }: JobContext): Promise<JobResult> {
  // Paused monitoring is not an outage. /api/ingest discards readings while
  // polling_enabled is false, so the silence this job measures is the user's
  // own doing; mailing them "the router has gone quiet" with four causes, none
  // of which is "you paused it", and an all-clear on unpause, would be noise.
  if (!settings.polling_enabled) {
    return { status: "skipped", detail: "monitoring is paused" };
  }

  if (settings.stale_after_minutes <= 0) {
    return { status: "skipped", detail: "stale_after_minutes is 0" };
  }

  const [latest, lastStale, lastRecovered, lastRun] = await Promise.all([
    getLatestReading(),
    latestAlert("link_stale", SCOPE),
    latestAlert("link_recovered", SCOPE),
    getJobRun(JOB_NAME),
  ]);
  const lastReadingAt = latest?.recorded_at ?? null;
  const silentSeconds = lastReadingAt ? Math.round((now.getTime() - lastReadingAt.getTime()) / 1000) : 0;

  /**
   * Secondary guard, behind the alerts log above.
   *
   * dispatchAlert returns {status: "sent", row: null} when the mail went out
   * but the `alerts` INSERT recording it failed - correct for callers whose
   * claim lives elsewhere, but here that lost row IS the state, so the next
   * tick would see no complaint and mail the same person again, every five
   * minutes, for as long as the insert keeps failing. job_runs is a different
   * table written by the tick after this job returns, so it still stands when
   * the alerts insert is the thing that broke: if this job's own last run
   * already sent this mail, and nothing has happened since that would call for
   * a fresh one, stay quiet.
   *
   * `since` is the event a new mail would be about: the newest reading for a
   * complaint (a reading after the run means that outage is over), and the
   * complaint itself for an all-clear.
   */
  const alreadySent = (kind: "link_stale" | "link_recovered", since: Date | null): boolean =>
    lastRun !== null &&
    lastRun.last_status === "ok" &&
    lastRun.last_detail === detailFor(kind, "sent") &&
    (since === null || lastRun.last_run_at > since);

  const action = decideStaleAction({
    now,
    staleAfterMinutes: settings.stale_after_minutes,
    lastReadingAt,
    lastStale,
    lastRecovered,
  });

  if (action === "send_stale") {
    if (alreadySent("link_stale", lastReadingAt)) {
      return { status: "skipped", detail: "link_stale already sent for this outage (job_runs)" };
    }
    const email = renderLinkEmail({
      kind: "stale",
      locale: alertLocale(settings),
      last_reading_at: lastReadingAt?.toISOString() ?? null,
      silent_seconds: silentSeconds,
      timezone: settings.timezone,
      app_url: appUrl(),
    });
    const { status } = await dispatchAlert({
      kind: "link_stale",
      level: null,
      scopeKey: SCOPE,
      to: settings.alert_email_to,
      email,
      payload: { last_reading_at: lastReadingAt?.toISOString() ?? null, silent_seconds: silentSeconds },
    });
    return { status: status === "failed" ? "failed" : "ok", detail: detailFor("link_stale", status) };
  }

  if (action === "send_recovered" && lastStale && lastReadingAt) {
    if (alreadySent("link_recovered", lastStale.created_at)) {
      return { status: "skipped", detail: "link_recovered already sent for this outage (job_runs)" };
    }

    // Readings are back. The silence that ended ran from the last reading
    // before the complaint to the first reading after it; the complaint's
    // payload remembers the former.
    const before =
      typeof lastStale.payload?.last_reading_at === "string" ? new Date(lastStale.payload.last_reading_at) : null;
    const ended = before ? Math.round((lastReadingAt.getTime() - before.getTime()) / 1000) : 0;
    // The push that ended the silence has already stored what the router saw.
    // Failing to read it only costs the mail its cause line.
    const silence = before ? await findSilenceStartingAt(before).catch(() => null) : null;
    const email = renderLinkEmail({
      kind: "recovered",
      locale: alertLocale(settings),
      last_reading_at: lastReadingAt.toISOString(),
      silent_seconds: ended,
      timezone: settings.timezone,
      app_url: appUrl(),
      causes: silence?.segments ?? null,
    });
    const { status } = await dispatchAlert({
      kind: "link_recovered",
      level: null,
      scopeKey: SCOPE,
      to: settings.alert_email_to,
      email,
      payload: { last_reading_at: lastReadingAt.toISOString(), silent_seconds: ended },
    });
    return { status: status === "failed" ? "failed" : "ok", detail: detailFor("link_recovered", status) };
  }

  const stale = isStale(lastReadingAt, now, settings.stale_after_minutes);
  return {
    status: "skipped",
    detail: stale ? "outage already reported" : `last reading ${silentSeconds}s ago`,
  };
}

export const staleJob: Job = { name: "stale", run };

registerJob(staleJob);
