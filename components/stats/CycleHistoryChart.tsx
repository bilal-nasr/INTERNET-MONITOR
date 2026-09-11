"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
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
import { fill, type Dictionary } from "@/lib/i18n";
import type { CycleTotal } from "@/lib/series";

/**
 * One bar per billing cycle against the monthly cap.
 *
 * The cycle in progress is drawn at reduced opacity and labelled as partial:
 * comparing a part-finished cycle with completed ones at full strength would
 * read as a drop in usage rather than a cycle that has not finished.
 */

interface Row extends CycleTotal {
  value: number;
  over: boolean;
}

function makeCycleTooltip(d: Dictionary) {
  return function CycleTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as Row;
    return (
      <TooltipShell title={fill(d.cycle.span, { start: row.start_date, end: row.end_date })}>
        <TooltipRow label={d.common.used} value={formatBytes(row.total_bytes)} color="var(--series-1)" />
        <TooltipRow label={d.common.download} value={formatBytes(row.rx_bytes)} />
        <TooltipRow label={d.common.upload} value={formatBytes(row.tx_bytes)} />
        {row.current ? (
          <TooltipRow label={d.common.status} value={d.charts.cycleInProgress} />
        ) : null}
      </TooltipShell>
    );
  };
}

export function CycleHistoryChart({ cycles, capGb }: { cycles: CycleTotal[]; capGb: number }) {
  const { d, dir } = useI18n();

  if (!cycles.some((c) => c.total_bytes > 0)) {
    return <Empty>{d.charts.cycleHistoryEmpty}</Empty>;
  }

  const capBytes = capGb * 1e9;
  const rows: Row[] = cycles.map((c) => ({
    ...c,
    value: bytesToGb(c.total_bytes),
    over: c.total_bytes > capBytes,
  }));

  const peakGb = Math.max(...rows.map((r) => r.value));
  // Scaling the axis to a cap far above actual use would squash every bar into
  // the baseline. Past double the heaviest cycle the line is dropped and the
  // caption carries the same fact in words instead.
  const showCap = capGb <= peakGb * 2;
  const maxGb = showCap ? Math.max(capGb, peakGb) : peakGb;
  const CycleTooltip = makeCycleTooltip(d);

  return (
    <div className="space-y-3">
      <Legend
        items={[
          { label: d.charts.withinCap, color: "var(--series-1)" },
          { label: d.charts.overCap, color: "var(--status-critical)" },
        ]}
      />
      <div className="h-52 w-full sm:h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={chartMargin(dir)} barCategoryGap={4}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" {...AXIS} axisLine={{ stroke: "var(--border)" }} minTickGap={8} />
            <YAxis
              {...AXIS}
              axisLine={false}
              width={52}
              unit=" GB"
              orientation={valueAxisSide(dir)}
              tickFormatter={gbTickFormatter(maxGb)}
            />
            <Tooltip content={CycleTooltip} cursor={{ fill: "var(--border)", opacity: 0.4 }} />
            {showCap && (
              <ReferenceLine
                y={capGb}
                stroke="var(--status-critical)"
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
                label={{
                  value: fill(d.charts.capLabel, { cap: capGb }),
                  position: "insideTopRight",
                  fontSize: 11,
                  fill: "var(--muted)",
                }}
              />
            )}
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell
                  key={r.start_date}
                  fill={r.over ? "var(--status-critical)" : "var(--series-1)"}
                  fillOpacity={r.current ? 0.45 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted">
        {d.charts.cycleHistoryNote}
        {showCap
          ? ""
          : ` ${fill(d.charts.capOffScale, { cap: capGb, peak: peakGb.toFixed(1) })}`}
      </p>
    </div>
  );
}
