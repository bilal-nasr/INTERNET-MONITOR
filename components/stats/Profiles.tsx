"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  TooltipRow,
  TooltipShell,
  chartMargin,
  valueAxisSide,
  AXIS,
} from "@/components/stats/chrome";
import { bytesToGb, formatBytes } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n";
import type { ProfileBar } from "@/lib/series";
import type { DurationBucket } from "@/lib/stats";

/**
 * Single-series bar charts: traffic by hour of day, traffic by weekday, and how
 * session lengths are distributed. One series each, so the heading names the
 * measure and no legend is needed. The busiest bar is picked out in the series
 * colour and every other bar is recessive, which is a rank highlight rather
 * than a second identity.
 *
 * The plot areas stay left to right in both languages. Each of these axes is
 * ordered -- midnight to midnight, Monday to Sunday, shortest to longest -- and
 * reversing an ordered axis states something different about the data rather
 * than translating it. Every label, tick and tooltip on it is translated.
 */

interface Row {
  label: string;
  value: number;
  bytes: number;
  readings: number;
  peak: boolean;
}

function makeBytesTooltip(d: Dictionary) {
  return function BytesTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as Row;
    return (
      <TooltipShell title={row.label}>
        <TooltipRow label={d.common.used} value={formatBytes(row.bytes)} color="var(--series-1)" />
        <TooltipRow label={d.common.readings} value={String(row.readings)} />
      </TooltipShell>
    );
  };
}

function ProfileChart({
  rows,
  interval,
  height = "h-48 sm:h-56",
}: {
  rows: Row[];
  interval?: number;
  height?: string;
}) {
  const { d, dir } = useI18n();

  if (!rows.some((r) => r.bytes > 0)) {
    return <Empty>{d.charts.noTraffic}</Empty>;
  }

  const maxGb = Math.max(0, ...rows.map((r) => r.value));
  const BytesTooltip = makeBytesTooltip(d);

  return (
    <div className={`${height} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={chartMargin(dir)} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            {...AXIS}
            axisLine={{ stroke: "var(--border)" }}
            interval={interval}
          />
          <YAxis
            {...AXIS}
            axisLine={false}
            width={52}
            unit=" GB"
            orientation={valueAxisSide(dir)}
            tickFormatter={gbTickFormatter(maxGb)}
          />
          <Tooltip content={BytesTooltip} cursor={{ fill: "var(--border)", opacity: 0.4 }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell
                key={r.label}
                fill={r.peak ? "var(--series-1)" : "var(--series-1)"}
                fillOpacity={r.peak ? 1 : 0.45}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function toRows(bars: ProfileBar[]): Row[] {
  const max = Math.max(0, ...bars.map((b) => b.total_bytes));
  return bars.map((b) => ({
    label: b.label,
    value: bytesToGb(b.total_bytes),
    bytes: b.total_bytes,
    readings: b.readings,
    peak: max > 0 && b.total_bytes === max,
  }));
}

export function HourProfileChart({ hours }: { hours: ProfileBar[] }) {
  return <ProfileChart rows={toRows(hours)} interval={2} />;
}

export function WeekdayProfileChart({ weekdays }: { weekdays: ProfileBar[] }) {
  return <ProfileChart rows={toRows(weekdays)} interval={0} />;
}

function makeCountTooltip(d: Dictionary) {
  return function CountTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as { label: string; value: number };
    return (
      <TooltipShell title={row.label}>
        <TooltipRow label={d.common.sessions} value={String(row.value)} color="var(--series-1)" />
      </TooltipShell>
    );
  };
}

export function DurationChart({ durations }: { durations: DurationBucket[] }) {
  const { d, dir } = useI18n();

  if (!durations.some((b) => b.sessions > 0)) {
    return <Empty>{d.charts.noSessions}</Empty>;
  }

  const max = Math.max(...durations.map((b) => b.sessions));
  const rows = durations.map((b) => ({
    label: b.label,
    value: b.sessions,
    peak: b.sessions === max,
  }));
  const CountTooltip = makeCountTooltip(d);

  return (
    <div className="h-48 w-full sm:h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={chartMargin(dir)} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" {...AXIS} axisLine={{ stroke: "var(--border)" }} interval={0} />
          <YAxis
            {...AXIS}
            axisLine={false}
            width={36}
            orientation={valueAxisSide(dir)}
            allowDecimals={false}
          />
          <Tooltip content={CountTooltip} cursor={{ fill: "var(--border)", opacity: 0.4 }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.label} fill="var(--series-1)" fillOpacity={r.peak ? 1 : 0.45} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
