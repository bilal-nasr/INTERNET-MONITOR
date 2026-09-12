"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { useI18n } from "@/components/I18nProvider";
import { chartMargin, TooltipRow, TooltipShell, valueAxisSide } from "@/components/stats/chrome";
import { formatRate } from "@/lib/format";
import { fill } from "@/lib/i18n";
import type { Formatters } from "@/lib/i18n/format";
import type { RatePoint } from "@/lib/throughput";

interface Row {
  /** Epoch milliseconds. The axis is a time scale, so gaps keep their width. */
  t: number;
  /** Megabits per second, the unit the marks are drawn in; null breaks the line. */
  rx_mbit: number | null;
  tx_mbit: number | null;
  /** The measurement this row draws, or null on an inserted break. */
  point: RatePoint | null;
}

const MBIT = 8 / 1e6;

/** A tolerance below one push interval, so ordinary jitter is not read as a gap. */
const ADJACENT_MS = 1_000;

/**
 * The rates as chart rows, with a null row wherever nothing was measured.
 *
 * Each point covers the interval `[at - seconds, at]`. When one point's
 * interval starts after the previous point ended, the time between them was
 * never measured: `ratesFromReadings` dropped the pair as an outage, a counter
 * reset or a change of interface. On a categorical axis those two points sit
 * side by side and a ten-minute outage is drawn as an unbroken line, so the
 * axis is a time scale and the unmeasured stretch gets a null row to break on.
 */
function toRows(rates: RatePoint[]): Row[] {
  const rows: Row[] = [];
  let measuredTo: number | null = null;

  for (const r of rates) {
    const at = new Date(r.at).getTime();
    const start = at - r.seconds * 1000;
    if (measuredTo !== null && start > measuredTo + ADJACENT_MS) {
      rows.push({ t: (measuredTo + start) / 2, rx_mbit: null, tx_mbit: null, point: null });
    }
    rows.push({
      t: at,
      rx_mbit: r.rx_per_second * MBIT,
      tx_mbit: r.tx_per_second * MBIT,
      point: r,
    });
    measuredTo = at;
  }
  return rows;
}

function makeTooltip(
  f: Formatters,
  timezone: string,
  labels: { download: string; upload: string; total: string },
) {
  return function ChartTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as Row;
    // A break row stands for an interval nothing was measured over.
    if (!row?.point) return null;
    const p = row.point;
    return (
      <TooltipShell title={f.clockWithSeconds(p.at, timezone)}>
        <TooltipRow label={labels.download} value={formatRate(p.rx_per_second)} color="var(--series-1)" />
        <TooltipRow label={labels.upload} value={formatRate(p.tx_per_second)} color="var(--series-2)" />
        <TooltipRow label={labels.total} value={formatRate(p.bytes_per_second)} />
      </TooltipShell>
    );
  };
}

/**
 * The last half hour of throughput as a sparkline, headlined by the newest
 * rate. Download is drawn as the filled area and upload as a thin line on top:
 * on a home link download dwarfs upload, so stacking them would hide the
 * upload entirely.
 */
export function ThroughputCard({
  rates,
  minutes,
  timezone,
}: {
  rates: RatePoint[];
  minutes: number;
  timezone: string;
}) {
  const { d, f, dir } = useI18n();
  const rows = toRows(rates);
  const latest = rates.length ? rates[rates.length - 1] : null;
  const ChartTooltip = makeTooltip(f, timezone, {
    download: d.common.download,
    upload: d.common.upload,
    total: d.common.total,
  });

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-muted">{d.dashboard.throughputHeading}</h2>
        <span className="text-xs text-muted">{fill(d.dashboard.throughputHint, { minutes })}</span>
      </div>

      {latest ? (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums tracking-tight">
              {formatRate(latest.bytes_per_second)}
            </span>
            {/* The swatches double as the chart's legend: the filled area is
                download, the thin line upload. */}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span>{d.dashboard.throughputNow}</span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-sm bg-series-1" />
                {d.common.download} <span className="tabular-nums text-foreground">{formatRate(latest.rx_per_second)}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-sm bg-series-2" />
                {d.common.upload} <span className="tabular-nums text-foreground">{formatRate(latest.tx_per_second)}</span>
              </span>
            </span>
          </div>
          <div className="mt-3 h-24 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={chartMargin(dir)}>
                {/* A time scale, not a category per point: skipped intervals
                    have to keep their width or an outage inside the window is
                    drawn as an unbroken line between the readings around it. */}
                <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} hide />
                <YAxis
                  hide
                  orientation={valueAxisSide(dir)}
                  domain={[0, (max: number) => Math.max(max, 0.1)]}
                />
                <Tooltip content={ChartTooltip} cursor={{ stroke: "var(--border)" }} />
                <Area
                  type="monotone"
                  dataKey="rx_mbit"
                  connectNulls={false}
                  stroke="var(--series-1)"
                  fill="var(--series-1)"
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="tx_mbit"
                  connectNulls={false}
                  stroke="var(--series-2)"
                  fill="none"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">{fill(d.dashboard.throughputEmpty, { minutes })}</p>
      )}
    </section>
  );
}
