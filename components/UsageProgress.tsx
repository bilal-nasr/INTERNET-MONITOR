import { Drums } from "@/components/meter/Drums";
import { MeterScale, MeterWindow } from "@/components/meter/MeterWindow";
import { Stamp } from "@/components/meter/Stamp";
import { formatBytes } from "@/lib/format";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { TodayUsage } from "@/lib/usage";

/**
 * Today's quota window, as one face of the meter: what has been used on the
 * drums, what is left beside it, the ruled scale beneath, and the state
 * stamped next to the reading it qualifies.
 */
export async function UsageProgress({ usage }: { usage: TodayUsage }) {
  const { d, f } = await getI18n();
  // With the daily quota off the window still reports its usage, but there is
  // nothing to measure it against: no scale, no stamp, no alert state.
  const quota = usage.quota_bytes;
  const percent = usage.percent_of_quota;
  const hasQuota = quota !== null && percent !== null;
  const pct = Math.min(100, Math.max(0, percent ?? 0));
  const over = quota !== null && usage.used_since_baseline > quota;
  const warn = !over && pct >= 80;
  const left = quota === null ? null : quota - usage.used_since_baseline;

  return (
    <MeterWindow
      label={d.dashboard.windowShort}
      aside={
        // The window is a clock range, so it is read left to right in both
        // languages; only the sentence around it changes direction.
        <>
          <span dir="ltr">
            {usage.window.start}-{usage.window.end}
          </span>{" "}
          {usage.window.active
            ? d.dashboard.windowActive
            : fill(d.dashboard.windowInactive, { time: usage.local_time })}
        </>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div>
          <div className="mb-1.5 text-xs text-muted">{d.dashboard.usedLabel}</div>
          <Drums value={formatBytes(usage.used_since_baseline)} />
        </div>
        {(hasQuota || usage.baseline === null) && (
          <QuotaStamp over={over} warn={warn} notified={usage.notified} hasBaseline={usage.baseline !== null} />
        )}
      </div>

      {hasQuota && left !== null ? (
        <>
          <MeterScale
            percent={pct}
            tone={over ? "critical" : warn ? "warning" : "good"}
            label={d.dashboard.progressLabel}
          />
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-muted">{over ? d.dashboard.overByLabel : d.dashboard.leftLabel}</span>
              <Drums value={formatBytes(Math.abs(left))} size="sm" />
            </span>
            <span className="text-xs tabular-nums text-muted">
              {fill(d.dashboard.ofQuotaShort, { quota: formatBytes(quota), percent: percent.toFixed(0) })}
            </span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">{d.dashboard.usedInWindow}</p>
      )}

      {/* Kept apart from the figure above, which does not include it. */}
      {usage.free && usage.free.bytes > 0 && (
        <div className="mt-3">
          <Stamp tone="free">{fill(d.dashboard.freeToday, { bytes: formatBytes(usage.free.bytes) })}</Stamp>
        </div>
      )}

      {/* Pinned to the foot of the window, so the three windows in a row keep
          their detail lines on one level. */}
      <div className="mt-auto pt-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
        <div>
          <dt className="text-muted">{d.dashboard.baselineSet}</dt>
          <dd>{usage.baseline ? f.stamp(usage.baseline.recorded_at, usage.timezone) : d.common.notYet}</dd>
        </div>
        <div>
          <dt className="text-muted">{d.dashboard.readingsToday}</dt>
          <dd>{f.count(usage.readings_count)}</dd>
        </div>
        {hasQuota && (
          <>
            <div>
              <dt className="text-muted">{d.dashboard.quota}</dt>
              <dd>{usage.quota_gb} GB</dd>
            </div>
            <div>
              <dt className="text-muted">{d.dashboard.alertSent}</dt>
              <dd>{usage.notified ? d.common.yes : d.common.no}</dd>
            </div>
          </>
        )}
      </dl>
      </div>
    </MeterWindow>
  );
}

async function QuotaStamp({
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
  if (!hasBaseline) return <Stamp tone="neutral">{d.dashboard.waitingForWindow}</Stamp>;
  if (over) return <Stamp tone="critical">{notified ? d.dashboard.overQuotaAlerted : d.dashboard.overQuota}</Stamp>;
  if (warn) return <Stamp tone="warning">{d.dashboard.approachingQuota}</Stamp>;
  return <Stamp tone="good">{d.dashboard.withinQuota}</Stamp>;
}
