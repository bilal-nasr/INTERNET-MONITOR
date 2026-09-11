import { formatBytes } from "@/lib/format";
import type { TodayUsage } from "@/lib/usage";

export function UsageProgress({ usage }: { usage: TodayUsage }) {
  const pct = Math.min(100, Math.max(0, usage.percent_of_quota));
  const over = usage.used_since_baseline > usage.quota_bytes;
  const warn = !over && pct >= 80;
  const barColor = over ? "bg-status-critical" : warn ? "bg-status-warning" : "bg-series-1";

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted">Today in the quota window</h2>
        <span className="text-xs text-muted">
          {usage.window.start}-{usage.window.end} {usage.timezone}
          {usage.window.active ? " (active now)" : ` (now ${usage.local_time})`}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <div className="text-3xl font-semibold tabular-nums tracking-tight">
            {formatBytes(usage.used_since_baseline)}
          </div>
          <div className="text-sm text-muted">
            of {formatBytes(usage.quota_bytes)} quota ({usage.percent_of_quota.toFixed(0)}%)
          </div>
        </div>
        <Badge over={over} warn={warn} notified={usage.notified} hasBaseline={usage.baseline !== null} />
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label="Usage as a percentage of the daily quota"
        className="mt-4 h-3 w-full overflow-hidden rounded-full bg-border"
      >
        <div className={`h-full rounded-full ${barColor} transition-[width]`} style={{ width: `${pct}%` }} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-4">
        <div>
          <dt>Baseline set</dt>
          <dd className="text-foreground">
            {usage.baseline ? formatTime(usage.baseline.recorded_at, usage.timezone) : "not yet"}
          </dd>
        </div>
        <div>
          <dt>Readings today</dt>
          <dd className="text-foreground tabular-nums">{usage.readings.length}</dd>
        </div>
        <div>
          <dt>Quota</dt>
          <dd className="text-foreground tabular-nums">{usage.quota_gb} GB</dd>
        </div>
        <div>
          <dt>Alert sent</dt>
          <dd className="text-foreground">{usage.notified ? "yes" : "no"}</dd>
        </div>
      </dl>
    </section>
  );
}

function Badge({
  over,
  warn,
  notified,
  hasBaseline,
}: {
  over: boolean;
  warn: boolean;
  notified: boolean;
  hasBaseline: boolean;
}) {
  if (!hasBaseline) {
    return <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted">Waiting for window</span>;
  }
  if (over) {
    return (
      <span className="rounded-full bg-status-critical/15 px-2.5 py-1 text-xs font-medium text-status-critical">
        &#9888; Over quota{notified ? ", alerted" : ""}
      </span>
    );
  }
  if (warn) {
    return (
      <span className="rounded-full bg-status-warning/20 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-status-warning">
        &#9650; Approaching quota
      </span>
    );
  }
  return (
    <span className="rounded-full bg-status-good/15 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-status-good">
      &#10003; Within quota
    </span>
  );
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(new Date(iso));
}
