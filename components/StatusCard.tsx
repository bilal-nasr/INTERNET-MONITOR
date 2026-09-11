import { formatBytes } from "@/lib/format";
import type { SessionSummary } from "@/lib/sessions";
import { formatDuration } from "@/lib/time";
import type { TodayUsage } from "@/lib/usage";
import { formatTime } from "@/components/UsageProgress";

/** Readings older than this are flagged; the router script posts every 1-5 minutes. */
const STALE_AFTER_MINUTES = 30;

export function StatusCard({
  usage,
  pollingEnabled,
  interfaceName,
  session = null,
}: {
  usage: TodayUsage;
  pollingEnabled: boolean;
  interfaceName: string;
  /** The currently open link session, when one is being tracked. */
  session?: SessionSummary | null;
}) {
  // Age is measured against the snapshot time so the component stays pure.
  const ageMinutes = usage.last_reading
    ? Math.round(
        (new Date(usage.generated_at).getTime() - new Date(usage.last_reading.recorded_at).getTime()) / 60_000,
      )
    : null;
  const stale = pollingEnabled && ageMinutes !== null && ageMinutes > STALE_AFTER_MINUTES;

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium text-muted">Router</h2>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Interface</dt>
          <dd className="font-medium">{interfaceName}</dd>
          <dd className="text-xs text-muted">Router posts readings to /api/ingest</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Last reading</dt>
          <dd className="font-medium">
            {usage.last_reading ? formatTime(usage.last_reading.recorded_at, usage.timezone) : "never"}
            {ageMinutes !== null && (
              <span className={`ml-2 text-xs font-normal ${stale ? "text-status-critical" : "text-muted"}`}>
                {ageMinutes < 1 ? "just now" : `${ageMinutes} min ago`}
              </span>
            )}
          </dd>
          {usage.last_reading && (
            <dd className="text-xs tabular-nums text-muted">
              tx {formatBytes(usage.last_reading.tx_bytes)} / rx {formatBytes(usage.last_reading.rx_bytes)}
            </dd>
          )}
          {stale && (
            <dd className="mt-1 text-xs text-status-critical">
              &#9888; No reading for over {STALE_AFTER_MINUTES} minutes. Check the router&apos;s scheduler and its log.
            </dd>
          )}
          {pollingEnabled && !usage.last_reading && (
            <dd className="mt-1 text-xs text-muted">Waiting for the first reading.</dd>
          )}
        </div>
        {session && (
          <div>
            <dt className="text-xs text-muted">Current session</dt>
            <dd className="font-medium tabular-nums">up {formatDuration(session.uptime_seconds)}</dd>
            <dd className="text-xs tabular-nums text-muted">
              {formatBytes(session.total_bytes)} since {formatTime(session.started_at, usage.timezone)}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted">Monitoring</dt>
          <dd className={`font-medium ${pollingEnabled ? "" : "text-amber-700 dark:text-status-warning"}`}>
            {pollingEnabled ? "enabled" : "paused, incoming readings are discarded"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
