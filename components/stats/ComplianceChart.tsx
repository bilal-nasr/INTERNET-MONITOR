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
import type { Dictionary } from "@/lib/i18n";
import { formatBucketTitle } from "@/lib/series";
import type { ComplianceSummary } from "@/lib/stats";

/**
 * Daily usage inside the quota window, against the quota line.
 *
 * Bars are coloured by state, not identity: a day is either within the quota or
 * over it, and the dashed line shows exactly where the boundary sits, so the
 * colour repeats information the chart already carries geometrically.
 */

interface Row {
  day: string;
  label: string;
  value: number;
  bytes: number;
  over: boolean;
  notified: boolean;
}

function makeComplianceTooltip(d: Dictionary) {
  return function ComplianceTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as Row;
    return (
      <TooltipShell title={formatBucketTitle(`${row.day}T00:00:00`, "day", d)}>
        <TooltipRow
          label={d.charts.inWindow}
          value={formatBytes(row.bytes)}
          color={row.over ? "var(--status-critical)" : "var(--series-1)"}
        />
        <TooltipRow
          label={d.common.status}
          value={row.over ? d.charts.overQuota : d.charts.withinQuota}
        />
        {row.notified ? <TooltipRow label={d.common.alert} value={d.common.sent} /> : null}
      </TooltipShell>
    );
  };
}

export function ComplianceChart({ compliance }: { compliance: ComplianceSummary }) {
  const { d, dir } = useI18n();

  if (compliance.days.length === 0) {
    return <Empty>{d.charts.complianceEmpty}</Empty>;
  }

  const rows: Row[] = compliance.days.map((day) => ({
    day: day.day,
    label: `${Number(day.day.slice(8, 10))}/${day.day.slice(5, 7)}`,
    value: bytesToGb(day.used_bytes),
    bytes: day.used_bytes,
    over: day.used_bytes > compliance.quota_bytes,
    notified: day.notified,
  }));

  // The quota line is part of the picture, so the axis must reach it even on a
  // range where every day came in well under.
  const maxGb = Math.max(bytesToGb(compliance.quota_bytes), ...rows.map((r) => r.value));
  const ComplianceTooltip = makeComplianceTooltip(d);

  return (
    <div className="space-y-3">
      <Legend
        items={[
          { label: d.charts.withinQuota, color: "var(--series-1)" },
          { label: d.charts.overQuota, color: "var(--status-critical)" },
        ]}
      />
      <div className="h-52 w-full sm:h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={chartMargin(dir)} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              {...AXIS}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={20}
            />
            <YAxis
              {...AXIS}
              axisLine={false}
              width={52}
              unit=" GB"
              orientation={valueAxisSide(dir)}
              tickFormatter={gbTickFormatter(maxGb)}
            />
            <Tooltip content={ComplianceTooltip} cursor={{ fill: "var(--border)", opacity: 0.4 }} />
            <ReferenceLine
              y={bytesToGb(compliance.quota_bytes)}
              stroke="var(--status-critical)"
              strokeDasharray="4 4"
              // Without this the axis is scaled to the bars alone and the quota
              // line falls off the top, so a compliant range shows no quota at
              // all: the one thing the chart exists to compare against.
              ifOverflow="extendDomain"
              label={{
                value: d.charts.quota,
                position: "insideTopRight",
                fontSize: 11,
                fill: "var(--muted)",
              }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell
                  key={r.day}
                  fill={r.over ? "var(--status-critical)" : "var(--series-1)"}
                  fillOpacity={r.over ? 1 : 0.75}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
