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
 * Traffic over time, what the cap counted stacked under what fell in the free
 * hours. Same shape rules as the usage timeline: bars while there are few
 * buckets, a filled area once there are too many for bars to read.
 */
const BAR_LIMIT = 60;

interface Row extends SeriesPoint {
  label: string;
  counted: number;
  free: number;
}

function toRows(series: SeriesPoint[], unit: BucketUnit, d: Dictionary): Row[] {
  return series.map((p) => ({
    ...p,
    label: formatBucketLabel(p.bucket, unit, d),
    counted: bytesToGb(p.total_bytes - p.free_bytes),
    free: bytesToGb(p.free_bytes),
  }));
}

function makeTooltip(unit: BucketUnit, d: Dictionary) {
  return function ChartTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as Row;
    return (
      <TooltipShell title={formatBucketTitle(row.bucket, unit, d)}>
        <TooltipRow
          label={d.stats.freeTable.counted}
          value={formatBytes(row.total_bytes - row.free_bytes)}
          color="var(--series-1)"
        />
        <TooltipRow label={d.stats.freeTable.free} value={formatBytes(row.free_bytes)} color="var(--series-3)" />
        <TooltipRow label={d.common.total} value={formatBytes(row.total_bytes)} />
      </TooltipShell>
    );
  };
}

export function FreeHoursChart({
  series,
  bucket,
  totals,
}: {
  series: SeriesPoint[];
  bucket: BucketUnit;
  totals: { counted_bytes: number; free_bytes: number };
}) {
  const { d, dir } = useI18n();
  const rows = toRows(series, bucket, d);
  const asBars = rows.length <= BAR_LIMIT;
  const maxGb = Math.max(0, ...rows.map((r) => r.counted + r.free));
  const ChartTooltip = makeTooltip(bucket, d);

  if (!rows.some((r) => r.total_bytes > 0)) {
    return <Empty>{d.charts.noTraffic}</Empty>;
  }

  return (
    <div className="space-y-3">
      <Legend
        items={[
          { label: d.stats.freeTable.counted, color: "var(--series-1)", value: formatBytes(totals.counted_bytes) },
          { label: d.stats.freeTable.free, color: "var(--series-3)", value: formatBytes(totals.free_bytes) },
        ]}
      />
      <div className="h-56 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={chartMargin(dir)}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" {...AXIS} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
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
                <Bar
                  dataKey="counted"
                  stackId="traffic"
                  fill="var(--series-1)"
                  maxBarSize={28}
                  isAnimationActive={false}
                  stroke="var(--surface)"
                  strokeWidth={1}
                />
                <Bar
                  dataKey="free"
                  stackId="traffic"
                  fill="var(--series-3)"
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
                  dataKey="counted"
                  stackId="traffic"
                  stroke="var(--series-1)"
                  strokeWidth={2}
                  fill="var(--series-1)"
                  fillOpacity={0.25}
                  isAnimationActive={false}
                />
                <Area
                  dataKey="free"
                  stackId="traffic"
                  stroke="var(--series-3)"
                  strokeWidth={2}
                  fill="var(--series-3)"
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
