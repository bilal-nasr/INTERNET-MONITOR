import { Empty } from "@/components/stats/chrome";
import { formatBytes } from "@/lib/format";
import { fill, type Dictionary } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { HeatCell } from "@/lib/stats";

/**
 * Traffic by weekday and hour of day.
 *
 * A CSS grid rather than a charting library: 168 coloured squares need no axes,
 * no scales and no client JavaScript. The scale is a single hue running from
 * near the surface to deep, so magnitude reads as intensity and nothing has to
 * be decoded from a hue wheel.
 *
 * Every cell carries its value in a title and in screen-reader text, so the
 * figure is never colour-alone.
 */

/** Six steps, palest first, from the sequential ramp in globals.css. */
const STEPS = [
  "var(--scale-1)",
  "var(--scale-2)",
  "var(--scale-3)",
  "var(--scale-4)",
  "var(--scale-5)",
  "var(--scale-6)",
] as const;

function stepFor(bytes: number, max: number): string | null {
  if (bytes <= 0 || max <= 0) return null;
  // Square-rooted, because home traffic is heavily skewed: on a linear scale a
  // single evening of streaming flattens every other hour to the palest step.
  const share = Math.sqrt(bytes / max);
  const index = Math.min(STEPS.length - 1, Math.floor(share * STEPS.length));
  return STEPS[index];
}

export async function UsageHeatmap({ cells }: { cells: HeatCell[] }) {
  const { d } = await getI18n();
  const max = Math.max(0, ...cells.map((c) => c.total_bytes));
  if (max <= 0) {
    return <Empty>{d.charts.noTraffic}</Empty>;
  }

  const byKey = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c]));
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="space-y-3">
      {/* Twenty-four columns cannot be both legible and 375px wide, so the grid
          keeps a workable minimum and scrolls sideways on a phone. Nothing is
          lost by scrolling here: the figures live in each cell's label, and the
          two profile charts below say the same thing without a matrix.

          The matrix itself stays ltr in both languages, because its columns are
          hours 00 to 23: that is a time axis, and running it right to left
          would reverse the day rather than translate it. */}
      <div dir="ltr" className="-mx-1 overflow-x-auto px-1">
        <div className="min-w-[26rem] sm:min-w-[34rem]">
          <div className="grid grid-cols-[2rem_repeat(24,minmax(0,1fr))] gap-[2px] sm:grid-cols-[2.5rem_repeat(24,minmax(0,1fr))]">
            <div />
            {hours.map((h) => (
              <div key={h} className="text-center text-[10px] leading-4 text-muted">
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </div>
            ))}

            {d.weekdays.map((label, index) => (
              <Row key={label} label={label} weekday={index + 1} byKey={byKey} max={max} d={d} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span>{d.charts.quieter}</span>
        <div className="flex gap-[2px]">
          {STEPS.map((step) => (
            <span key={step} aria-hidden className="size-3 rounded-[2px]" style={{ background: step }} />
          ))}
        </div>
        <span>{d.charts.busier}</span>
        <span className="tabular-nums sm:ms-auto">
          {fill(d.charts.busiestHourValue, { bytes: formatBytes(max) })}
        </span>
      </div>
    </div>
  );
}

function Row({
  label,
  weekday,
  byKey,
  max,
  d,
}: {
  label: string;
  weekday: number;
  byKey: Map<string, HeatCell>;
  max: number;
  d: Dictionary;
}) {
  return (
    <>
      <div className="flex items-center text-[11px] text-muted">{label}</div>
      {Array.from({ length: 24 }, (_, hour) => {
        const cell = byKey.get(`${weekday}-${hour}`);
        const bytes = cell?.total_bytes ?? 0;
        const background = stepFor(bytes, max);
        const time = `${String(hour).padStart(2, "0")}:00`;
        const value = cell ? formatBytes(bytes) : d.charts.noReadings;
        const description = fill(d.charts.heatCell, { weekday: label, time, value });
        return (
          <div
            key={hour}
            title={description}
            // `relative` is load-bearing: the screen-reader label inside is
            // absolutely positioned, so without a positioned ancestor it is laid
            // out against the page and widens the whole document past the phone
            // viewport, escaping the scroll container around this grid.
            className="relative aspect-square rounded-[2px] border border-border/70"
            style={background ? { background, borderColor: background } : undefined}
          >
            <span className="sr-only">{description}</span>
          </div>
        );
      })}
    </>
  );
}
