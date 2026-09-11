import { formatBytes } from "@/lib/format";
import type { TodayUsage } from "@/lib/usage";
import { formatTime } from "@/components/UsageProgress";

export type RouterStatus =
  | { state: "running"; name: string }
  | { state: "down"; name: string }
  | { state: "disabled"; name: string }
  | { state: "unreachable"; message: string }
  | { state: "not_configured"; message: string }
  | { state: "push" }
  | { state: "paused" };

const labels: Record<RouterStatus["state"], { text: string; className: string }> = {
  running: { text: "Running", className: "text-green-700 dark:text-status-good" },
  down: { text: "Link down", className: "text-status-critical" },
  disabled: { text: "Disabled", className: "text-status-critical" },
  unreachable: { text: "Unreachable", className: "text-status-critical" },
  not_configured: { text: "Not configured", className: "text-muted" },
  push: { text: "Push mode", className: "text-foreground" },
  paused: { text: "Polling paused", className: "text-amber-700 dark:text-status-warning" },
};

/** Readings older than this are flagged; schedulers run every 5-15 minutes. */
const STALE_AFTER_MINUTES = 30;

function detailFor(router: RouterStatus): string {
  switch (router.state) {
    case "unreachable":
    case "not_configured":
      return router.message;
    case "paused":
      return "Enable polling in Settings to resume";
    case "push":
      return "Router sends readings to /api/ingest";
    default:
      return `interface ${router.name}`;
  }
}

export function StatusCard({
  usage,
  router,
  pollingEnabled,
}: {
  usage: TodayUsage;
  router: RouterStatus;
  pollingEnabled: boolean;
}) {
  const label = labels[router.state];
  const detail = detailFor(router);

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
          <dt className="text-xs text-muted">{router.state === "push" ? "Connection" : "Interface status (live)"}</dt>
          <dd className={`font-medium ${label.className}`}>{label.text}</dd>
          <dd className="truncate text-xs text-muted" title={detail}>
            {detail}
          </dd>
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
              &#9888; No reading for over {STALE_AFTER_MINUTES} minutes. Check the scheduler or the router script.
            </dd>
          )}
          {pollingEnabled && !usage.last_reading && (
            <dd className="mt-1 text-xs text-muted">Waiting for the first reading.</dd>
          )}
        </div>
        <div>
          <dt className="text-xs text-muted">Polling</dt>
          <dd className="font-medium">{pollingEnabled ? "enabled" : "paused"}</dd>
        </div>
      </dl>
    </section>
  );
}
