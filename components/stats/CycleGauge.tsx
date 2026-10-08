import { Drums } from "@/components/meter/Drums";
import { MeterScale, MeterWindow } from "@/components/meter/MeterWindow";
import { Stamp } from "@/components/meter/Stamp";
import { formatBytes } from "@/lib/format";
import { fill, type Dictionary } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { CycleUsage } from "@/lib/stats";

/**
 * Consumption against the monthly cap, as one face of the meter: the cycle's
 * count on the drums, the ruled scale with a projection marker, and the state
 * stamped beside the reading.
 *
 * Colours here are status, not series: the scale reports a state (comfortable,
 * close to the cap, over it), so each one arrives with its own wording too.
 */

type Tone = "good" | "warning" | "critical";

function toneFor(cycle: CycleUsage): Tone {
  if (cycle.over) return "critical";
  // Being on course to exceed the cap matters as much as already having done so.
  if (cycle.percent_of_cap >= 85 || cycle.projected_percent >= 100) return "warning";
  return "good";
}

function statusLine(cycle: CycleUsage, tone: Tone, d: Dictionary): string {
  if (tone === "critical") return d.cycle.overCap;
  if (cycle.projected_percent >= 100) return d.cycle.onCourseToExceed;
  if (tone === "warning") return d.cycle.approachingCap;
  return d.cycle.onTrack;
}

export async function CycleGauge({
  cycle,
  timezone,
  compact = false,
}: {
  cycle: CycleUsage;
  timezone: string;
  compact?: boolean;
}) {
  const { d, f } = await getI18n();
  const tone = toneFor(cycle);

  return (
    <MeterWindow
      label={d.cycle.heading}
      aside={fill(d.cycle.span, {
        start: f.dayMonth(cycle.start, timezone),
        end: f.dayMonth(cycle.end, timezone),
      })}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div>
          <div className="mb-1.5 text-xs text-muted">{d.dashboard.usedLabel}</div>
          <Drums value={formatBytes(cycle.used_bytes)} />
        </div>
        <Stamp tone={tone}>{statusLine(cycle, tone, d)}</Stamp>
      </div>

      {/* The same ruler as today's window, with a hairline where the cycle
          lands if the current rate holds. */}
      <MeterScale
        percent={cycle.percent_of_cap}
        projected={cycle.projected_percent}
        tone={tone}
        label={d.cycle.ofCap}
      />
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-2">
          <span className="text-xs text-muted">{cycle.over ? d.dashboard.overByLabel : d.dashboard.leftLabel}</span>
          <Drums value={formatBytes(Math.abs(cycle.cap_bytes - cycle.used_bytes))} size="sm" />
        </span>
        <span className="text-xs tabular-nums text-muted">
          {fill(d.dashboard.ofQuotaShort, {
            quota: `${cycle.cap_gb} GB`,
            percent: cycle.percent_of_cap.toFixed(0),
          })}
        </span>
      </div>

      <div className="mt-auto pt-4">
        <dl
          className={`grid gap-x-4 gap-y-2 border-t border-border pt-3 text-xs ${
            compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-2"
          }`}
        >
          <Figure
            label={d.cycle.projected}
            value={formatBytes(cycle.projected_bytes)}
            hint={fill(d.cycle.projectedHint, { percent: cycle.projected_percent.toFixed(0) })}
          />
          <Figure
            label={d.cycle.dailyAverage}
            value={formatBytes(cycle.daily_average_bytes)}
            hint={fill(d.cycle.dailyAverageHint, { days: cycle.days_elapsed })}
          />
          <Figure
            label={d.cycle.dailyBudgetLeft}
            value={formatBytes(cycle.daily_budget_bytes)}
            hint={fill(d.cycle.dailyBudgetHint, { days: cycle.days_remaining })}
          />
          <Figure
            label={d.cycle.remaining}
            value={formatBytes(Math.max(0, cycle.cap_bytes - cycle.used_bytes))}
            hint={cycle.over ? d.cycle.capExceeded : d.cycle.beforeTheCap}
          />
        </dl>

        {/* Recorded on its own: none of the figures above include it. */}
        {cycle.free && (
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border pt-3 text-xs">
            <span className="text-muted">
              {d.cycle.freeHours}{" "}
              <span dir="ltr">
                {cycle.free.start}-{cycle.free.end}
              </span>
            </span>
            <span>
              <span className="font-medium tabular-nums">{formatBytes(cycle.free.bytes)}</span>{" "}
              <span className="text-muted">{d.cycle.freeHoursHint}</span>
            </span>
          </div>
        )}
      </div>
    </MeterWindow>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
      <dd className="text-muted">{hint}</dd>
    </div>
  );
}
