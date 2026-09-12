import { NextResponse } from "next/server";
import { errorResponse, hasBearer, rejectUnauthenticated } from "@/lib/api";
import { getCycleUsageCached } from "@/lib/cycle-cache";
import { renderPrometheus, type MetricsSample } from "@/lib/metrics";
import { getLatestSessionSummary } from "@/lib/sessions";
import { getSettings } from "@/lib/settings";
import { getTodayUsage } from "@/lib/usage";

export const maxDuration = 30;

/** Matches the dashboard's StatusCard: past ten missed pushes the link state is unknown. */
const SILENT_AFTER_SECONDS = 300;

/**
 * Prometheus scrape target. A scraper has no browser session, so it presents
 * METRICS_TOKEN instead; a person opening the URL signed in sees the same text.
 * With no token configured only the session works.
 *
 * The cycle figure comes from the same five-minute cache the ingest push uses.
 * It is one delta aggregate over a whole billing cycle -- tens of thousands of
 * rows by the end of a month -- and a scraper asks for it far more often than
 * it can change, so re-running it on every scrape is exactly the cost the
 * cache exists to avoid.
 */
export async function GET(request: Request) {
  if (!hasBearer(request, process.env.METRICS_TOKEN)) {
    const denied = await rejectUnauthenticated(request);
    if (denied) return denied;
  }

  try {
    const now = new Date();
    const settings = await getSettings();
    const [usage, cycle, session] = await Promise.all([
      getTodayUsage(settings, now),
      getCycleUsageCached(settings, now),
      getLatestSessionSummary(),
    ]);

    const sample: MetricsSample = {
      today_used_bytes: usage.used_since_baseline,
      today_quota_bytes: usage.quota_bytes,
      today_percent: usage.percent_of_quota,
      window_active: usage.window.active,
      cycle_used_bytes: cycle.used_bytes,
      cycle_cap_bytes: cycle.cap_bytes,
      cycle_percent: cycle.percent_of_cap,
      last_reading_age_seconds: usage.last_reading
        ? Math.max(0, Math.round((now.getTime() - new Date(usage.last_reading.recorded_at).getTime()) / 1000))
        : null,
      link_up: session ? session.open && session.seconds_since_seen <= SILENT_AFTER_SECONDS : null,
      session_uptime_seconds: session && session.open ? session.uptime_seconds : null,
      polling_enabled: settings.polling_enabled,
    };

    return new NextResponse(renderPrometheus(sample), {
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
