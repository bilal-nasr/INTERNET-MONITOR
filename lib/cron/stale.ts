/**
 * "The router has gone quiet."
 *
 * Nothing runs when the router stops pushing, which is exactly why this check
 * cannot live on the ingest path and has to be driven by the tick. It sends
 * one mail when the silence passes the limit and one more when readings
 * resume. The alerts log is the state: the newest link_* rows say whether an
 * outage is currently being reported - see lib/cron/stale-decision.ts for the
 * pure branch-selection logic (unit-tested there without a database).
 */

import { dispatchAlert } from "@/lib/alerts/dispatch";
import { latestAlert } from "@/lib/alerts/log";
import { registerJob, type Job, type JobContext, type JobResult } from "@/lib/cron/jobs";
import { isStale } from "@/lib/cron/schedule";
import { decideStaleAction } from "@/lib/cron/stale-decision";
import { renderLinkEmail } from "@/lib/email-link-template";
import { alertLocale } from "@/lib/settings";
import { getLatestReading } from "@/lib/usage";

const SCOPE = "link";

function appUrl(): string | null {
  const raw = process.env.APP_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

async function run({ now, settings }: JobContext): Promise<JobResult> {
  if (settings.stale_after_minutes <= 0) {
    return { status: "skipped", detail: "stale_after_minutes is 0" };
  }

  const [latest, lastStale, lastRecovered] = await Promise.all([
    getLatestReading(),
    latestAlert("link_stale", SCOPE),
    latestAlert("link_recovered", SCOPE),
  ]);
  const lastReadingAt = latest?.recorded_at ?? null;
  const silentSeconds = lastReadingAt ? Math.round((now.getTime() - lastReadingAt.getTime()) / 1000) : 0;

  const action = decideStaleAction({
    now,
    staleAfterMinutes: settings.stale_after_minutes,
    lastReadingAt,
    lastStale,
    lastRecovered,
  });

  if (action === "send_stale") {
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
    return { status: status === "failed" ? "failed" : "ok", detail: `link_stale ${status}` };
  }

  if (action === "send_recovered" && lastStale && lastReadingAt) {
    // Readings are back. The silence that ended ran from the last reading
    // before the complaint to the first reading after it; the complaint's
    // payload remembers the former.
    const before =
      typeof lastStale.payload?.last_reading_at === "string" ? new Date(lastStale.payload.last_reading_at) : null;
    const ended = before ? Math.round((lastReadingAt.getTime() - before.getTime()) / 1000) : 0;
    const email = renderLinkEmail({
      kind: "recovered",
      locale: alertLocale(settings),
      last_reading_at: lastReadingAt.toISOString(),
      silent_seconds: ended,
      timezone: settings.timezone,
      app_url: appUrl(),
    });
    const { status } = await dispatchAlert({
      kind: "link_recovered",
      level: null,
      scopeKey: SCOPE,
      to: settings.alert_email_to,
      email,
      payload: { last_reading_at: lastReadingAt.toISOString(), silent_seconds: ended },
    });
    return { status: status === "failed" ? "failed" : "ok", detail: `link_recovered ${status}` };
  }

  const stale = isStale(lastReadingAt, now, settings.stale_after_minutes);
  return {
    status: "skipped",
    detail: stale ? "outage already reported" : `last reading ${silentSeconds}s ago`,
  };
}

export const staleJob: Job = { name: "stale", run };

registerJob(staleJob);
