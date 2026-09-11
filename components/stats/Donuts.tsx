"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { useI18n } from "@/components/I18nProvider";
import { Empty, Legend } from "@/components/stats/chrome";
import { formatBytes } from "@/lib/format";

/**
 * Two-part donuts, for the only question a donut answers well: how one whole
 * splits in two.
 *
 * Hovering a slice rewrites the middle of the ring rather than floating a
 * tooltip over it. A tooltip would land exactly on the centre label, which is
 * the one place a donut always has text, and the two would overlap. Moving the
 * hover readout into that same slot means only ever one thing is written there.
 */

interface Slice {
  name: string;
  value: number;
  color: string;
  display: string;
}

function Donut({
  slices,
  centreValue,
  centreLabel,
}: {
  slices: Slice[];
  centreValue: string;
  centreLabel: string;
}) {
  const { d } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (total <= 0) {
    return <Empty>{d.charts.nothingRecorded}</Empty>;
  }

  const hovered = active === null ? null : slices[active];

  return (
    <div className="space-y-3">
      <div className="relative h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              innerRadius="64%"
              outerRadius="92%"
              startAngle={90}
              endAngle={-270}
              // A surface-coloured gap keeps the two arcs separate marks rather
              // than one ring that happens to change colour.
              paddingAngle={2}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
              onMouseEnter={(_, index: number) => setActive(index)}
              onMouseLeave={() => setActive(null)}
            >
              {slices.map((s, index) => (
                <Cell
                  key={s.name}
                  fill={s.color}
                  fillOpacity={active === null || active === index ? 1 : 0.35}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Sized to the hole so a long value wraps inside the ring instead of
            running out over the arcs. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-28 text-center">
            <div className="truncate text-xl font-semibold tabular-nums tracking-tight">
              {hovered ? hovered.display : centreValue}
            </div>
            <div className="truncate text-xs text-muted">
              {hovered ? `${percent(hovered.value, total)} ${hovered.name}` : centreLabel}
            </div>
          </div>
        </div>
      </div>

      <Legend
        items={slices.map((s) => ({
          label: `${s.name} ${percent(s.value, total)}`,
          color: s.color,
          value: s.display,
        }))}
      />
    </div>
  );
}

function percent(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(0)}%`;
}

export function TrafficSplitDonut({ rxBytes, txBytes }: { rxBytes: number; txBytes: number }) {
  const { d } = useI18n();
  return (
    <Donut
      slices={[
        {
          name: d.common.download,
          value: rxBytes,
          color: "var(--series-1)",
          display: formatBytes(rxBytes),
        },
        {
          name: d.common.upload,
          value: txBytes,
          color: "var(--series-2)",
          display: formatBytes(txBytes),
        },
      ]}
      centreValue={formatBytes(rxBytes + txBytes)}
      centreLabel={d.stats.totalTraffic}
    />
  );
}

export function AvailabilityDonut({
  uptimeSeconds,
  downtimeSeconds,
  availability,
}: {
  uptimeSeconds: number;
  downtimeSeconds: number;
  availability: number;
}) {
  const { d, f } = useI18n();
  return (
    <Donut
      slices={[
        {
          name: d.charts.linkUp,
          value: uptimeSeconds,
          // Status colours, because up and down are states rather than series.
          color: "var(--status-good)",
          display: f.duration(uptimeSeconds),
        },
        {
          name: d.charts.offline,
          value: downtimeSeconds,
          color: "var(--status-critical)",
          display: f.duration(downtimeSeconds),
        },
      ]}
      centreValue={`${availability.toFixed(availability >= 99.95 ? 2 : 1)}%`}
      centreLabel={d.charts.availability}
    />
  );
}
