import { formatBytes } from "@/lib/format";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { TodayUsage } from "@/lib/usage";

export async function UsageProgress({ usage }: { usage: TodayUsage }) {
  const { d, f } = await getI18n();
  const pct = Math.min(100, Math.max(0, usage.percent_of_quota));
  const over = usage.used_since_baseline > usage.quota_bytes;
  const warn = !over && pct >= 80;
  const barColor = over ? "bg-status-critical" : warn ? "bg-status-warning" : "bg-series-1";

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted">{d.dashboard.quotaWindowHeading}</h2>
        {/* The window is a clock range, so it is read left to right in both
            languages; only the sentence around it changes direction. */}
        <span className="text-xs text-muted">
          <span dir="ltr">
            {usage.window.start}-{usage.window.end}
          </span>{" "}
          {usage.timezone}{" "}
          {usage.window.active
            ? d.dashboard.windowActive
            : fill(d.dashboard.windowInactive, { time: usage.local_time })}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <div className="text-3xl font-semibold tabular-nums tracking-tight">
            {formatBytes(usage.used_since_baseline)}
          </div>
          <div className="text-sm text-muted">
            {fill(d.dashboard.ofQuota, {
              quota: formatBytes(usage.quota_bytes),
              percent: usage.percent_of_quota.toFixed(0),
            })}
          </div>
        </div>
        <Badge
          over={over}
          warn={warn}
          notified={usage.notified}
          hasBaseline={usage.baseline !== null}
        />
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={d.dashboard.progressLabel}
        className="mt-4 h-3 w-full overflow-hidden rounded-full bg-border"
      >
        <div className={`h-full rounded-full ${barColor} transition-[width]`} style={{ width: `${pct}%` }} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-4">
        <div>
          <dt>{d.dashboard.baselineSet}</dt>
          <dd className="text-foreground">
            {usage.baseline ? f.stamp(usage.baseline.recorded_at, usage.timezone) : d.common.notYet}
          </dd>
        </div>
        <div>
          <dt>{d.dashboard.readingsToday}</dt>
          <dd className="text-foreground tabular-nums">{f.count(usage.readings_count)}</dd>
        </div>
        <div>
          <dt>{d.dashboard.quota}</dt>
          <dd className="text-foreground tabular-nums">{usage.quota_gb} GB</dd>
        </div>
        <div>
          <dt>{d.dashboard.alertSent}</dt>
          <dd className="text-foreground">{usage.notified ? d.common.yes : d.common.no}</dd>
        </div>
      </dl>
    </section>
  );
}

async function Badge({
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
  const { d } = await getI18n();

  if (!hasBaseline) {
    return (
      <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted">
        {d.dashboard.waitingForWindow}
      </span>
    );
  }
  if (over) {
    return (
      <span className="rounded-full bg-status-critical/15 px-2.5 py-1 text-xs font-medium text-status-critical">
        &#9888; {notified ? d.dashboard.overQuotaAlerted : d.dashboard.overQuota}
      </span>
    );
  }
  if (warn) {
    return (
      <span className="rounded-full bg-status-warning/20 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-status-warning">
        &#9650; {d.dashboard.approachingQuota}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-status-good/15 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-status-good">
      &#10003; {d.dashboard.withinQuota}
    </span>
  );
}
