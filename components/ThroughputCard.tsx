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

interface Row extends RatePoint {
  /** Megabits per second, the unit the axis is drawn in. */
  mbit: number;
}

function toRows(rates: RatePoint[]): Row[] {
  return rates.map((r) => ({ ...r, mbit: (r.bytes_per_second * 8) / 1e6 }));
}

function makeTooltip(
  f: Formatters,
  timezone: string,
  labels: { download: string; upload: string; total: string },
) {
  return function ChartTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as Row;
    return (
      <TooltipShell title={f.clockWithSeconds(row.at, timezone)}>
        <TooltipRow label={labels.download} value={formatRate(row.rx_per_second)} color="var(--series-1)" />
        <TooltipRow label={labels.upload} value={formatRate(row.tx_per_second)} color="var(--series-2)" />
        <TooltipRow label={labels.total} value={formatRate(row.bytes_per_second)} />
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
  const latest = rows.length ? rows[rows.length - 1] : null;
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
            <span className="text-xs text-muted">
              {d.dashboard.throughputNow} · {d.common.download} {formatRate(latest.rx_per_second)} ·{" "}
              {d.common.upload} {formatRate(latest.tx_per_second)}
            </span>
          </div>
          <div className="mt-3 h-24 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={chartMargin(dir)}>
                <XAxis dataKey="at" hide />
                <YAxis
                  hide
                  orientation={valueAxisSide(dir)}
                  domain={[0, (max: number) => Math.max(max, 0.1)]}
                />
                <Tooltip content={ChartTooltip} cursor={{ stroke: "var(--border)" }} />
                <Area
                  type="monotone"
                  dataKey={(row: Row) => (row.rx_per_second * 8) / 1e6}
                  stroke="var(--series-1)"
                  fill="var(--series-1)"
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey={(row: Row) => (row.tx_per_second * 8) / 1e6}
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
