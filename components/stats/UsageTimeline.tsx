"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { useI18n } from "@/components/I18nProvider";
import {
  Empty,
  gbTickFormatter,
  Legend,
  TooltipRow,
  TooltipShell,
  chartMargin,
  valueAxisSide,
  AXIS,
} from "@/components/stats/chrome";
import { bytesToGb, formatBytes } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n";
import type { BucketUnit } from "@/lib/range";
import { formatBucketLabel, formatBucketTitle } from "@/lib/series";
import type { SeriesPoint } from "@/lib/stats";

/**
 * Traffic over time, download stacked on upload.
 *
 * Few buckets are drawn as bars, because each one is a discrete total worth
 * comparing; many buckets become a filled area, where the shape of the curve is
 * what carries the meaning and individual bars would be slivers.
 */
const BAR_LIMIT = 60;

interface Row extends SeriesPoint {
  label: string;
  rx: number;
  tx: number;
}

function toRows(series: SeriesPoint[], unit: BucketUnit, d: Dictionary): Row[] {
  return series.map((p) => ({
    ...p,
    label: formatBucketLabel(p.bucket, unit, d),
    rx: bytesToGb(p.rx_bytes),
    tx: bytesToGb(p.tx_bytes),
  }));
}

function makeTooltip(unit: BucketUnit, d: Dictionary) {
  return function ChartTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as Row;
    return (
      <TooltipShell title={formatBucketTitle(row.bucket, unit, d)}>
        <TooltipRow label={d.common.download} value={formatBytes(row.rx_bytes)} color="var(--series-1)" />
        <TooltipRow label={d.common.upload} value={formatBytes(row.tx_bytes)} color="var(--series-2)" />
        <TooltipRow label={d.common.total} value={formatBytes(row.total_bytes)} />
        <TooltipRow label={d.common.readings} value={String(row.readings)} />
      </TooltipShell>
    );
  };
}

export function UsageTimeline({
  series,
  bucket,
  totals,
}: {
  series: SeriesPoint[];
  bucket: BucketUnit;
  totals: { rx_bytes: number; tx_bytes: number };
}) {
  const { d, dir } = useI18n();
  const rows = toRows(series, bucket, d);
  const hasData = rows.some((r) => r.total_bytes > 0);
  const asBars = rows.length <= BAR_LIMIT;
  // Stacked, so the axis reaches the tallest total rather than the tallest series.
  const maxGb = Math.max(0, ...rows.map((r) => r.rx + r.tx));
  const ChartTooltip = makeTooltip(bucket, d);

  if (!hasData) {
    return <Empty>{d.charts.noTraffic}</Empty>;
  }

  return (
    <div className="space-y-3">
      <Legend
        items={[
          { label: d.common.download, color: "var(--series-1)", value: formatBytes(totals.rx_bytes) },
          { label: d.common.upload, color: "var(--series-2)", value: formatBytes(totals.tx_bytes) },
        ]}
      />
      <div className="h-56 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={chartMargin(dir)}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              {...AXIS}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={24}
            />
            <YAxis
              {...AXIS}
              axisLine={false}
              width={52}
              unit=" GB"
              orientation={valueAxisSide(dir)}
              tickFormatter={gbTickFormatter(maxGb)}
            />
            <Tooltip content={ChartTooltip} cursor={{ fill: "var(--border)", opacity: 0.4 }} />
            {asBars ? (
              <>
                {/* A 2px gap between the stacked segments keeps the boundary
                    readable when both are dark. */}
                <Bar
                  dataKey="rx"
                  stackId="traffic"
                  fill="var(--series-1)"
                  maxBarSize={28}
                  isAnimationActive={false}
                  stroke="var(--surface)"
                  strokeWidth={1}
                />
                <Bar
                  dataKey="tx"
                  stackId="traffic"
                  fill="var(--series-2)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                  isAnimationActive={false}
                  stroke="var(--surface)"
                  strokeWidth={1}
                />
              </>
            ) : (
              <>
                <Area
                  dataKey="rx"
                  stackId="traffic"
                  stroke="var(--series-1)"
                  strokeWidth={2}
                  fill="var(--series-1)"
                  fillOpacity={0.25}
                  isAnimationActive={false}
                />
                <Area
                  dataKey="tx"
                  stackId="traffic"
                  stroke="var(--series-2)"
                  strokeWidth={2}
                  fill="var(--series-2)"
                  fillOpacity={0.25}
                  isAnimationActive={false}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
