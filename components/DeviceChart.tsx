"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { useI18n } from "@/components/I18nProvider";
import {
  AXIS,
  Card,
  Empty,
  Legend,
  TooltipRow,
  TooltipShell,
  chartMargin,
  gbTickFormatter,
  valueAxisSide,
} from "@/components/stats/chrome";
import { OTHERS_KEY, type StackedRow } from "@/lib/devices/chart";
import { fill, type Dictionary } from "@/lib/i18n";
import type { BucketUnit } from "@/lib/range";
import { formatBucketLabel, formatBucketTitle } from "@/lib/series";

export interface DeviceSeriesEntry {
  mac: string;
  label: string;
}

const COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--series-${n})`);
const OTHERS_COLOR = "var(--border)";

function makeDeviceTooltip(
  d: Dictionary,
  devices: DeviceSeriesEntry[],
  colorOf: Map<string, string>,
  bucket: BucketUnit,
  hasOthers: boolean,
) {
  return function DeviceTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as StackedRow;
    return (
      <TooltipShell title={formatBucketTitle(row.bucket, bucket, d)}>
        {devices.map((dev) => (
          <TooltipRow
            key={dev.mac}
            label={dev.label}
            value={`${(row[dev.mac] as number).toFixed(2)} GB`}
            color={colorOf.get(dev.mac)}
          />
        ))}
        {hasOthers ? (
          <TooltipRow
            label={d.devices.others}
            value={`${(row[OTHERS_KEY] as number).toFixed(2)} GB`}
            color={OTHERS_COLOR}
          />
        ) : null}
      </TooltipShell>
    );
  };
}

/**
 * Daily (or hourly) traffic stacked by device. Colour identifies a device only
 * within this chart; the legend carries the names so identity never rests on
 * colour alone.
 */
export function DeviceChart({
  rows,
  devices,
  bucket,
  hasOthers,
}: {
  rows: StackedRow[];
  devices: DeviceSeriesEntry[];
  bucket: BucketUnit;
  hasOthers: boolean;
}) {
  const { d, dir } = useI18n();
  const colorOf = new Map(devices.map((dev, i) => [dev.mac, COLORS[i]]));
  const data = rows.map((r) => ({ ...r, label: formatBucketLabel(r.bucket, bucket, d) }));
  const maxGb = Math.max(
    0,
    ...rows.map((r) =>
      devices.reduce((sum, dev) => sum + (r[dev.mac] as number), r[OTHERS_KEY] as number),
    ),
  );

  const DeviceTooltip = makeDeviceTooltip(d, devices, colorOf, bucket, hasOthers);

  const legend = devices.map((dev) => ({ label: dev.label, color: colorOf.get(dev.mac) ?? "" }));
  if (hasOthers) legend.push({ label: d.devices.others, color: OTHERS_COLOR });

  return (
    <Card title={fill(d.devices.topDevices, { count: devices.length })} hint={d.devices.chartHint}>
      {rows.length === 0 ? (
        <Empty>{d.devices.empty}</Empty>
      ) : (
        <>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={chartMargin(dir)}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
                <YAxis
                  orientation={valueAxisSide(dir)}
                  {...AXIS}
                  width={36}
                  tickFormatter={gbTickFormatter(maxGb)}
                />
                <Tooltip content={DeviceTooltip} cursor={{ fill: "var(--border)", opacity: 0.4 }} />
                {devices.map((dev) => (
                  <Bar key={dev.mac} dataKey={dev.mac} stackId="a" fill={colorOf.get(dev.mac)} />
                ))}
                {hasOthers && (
                  <Bar
                    dataKey={OTHERS_KEY}
                    stackId="a"
                    fill={OTHERS_COLOR}
                    radius={[3, 3, 0, 0]}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3">
            <Legend items={legend} />
          </div>
        </>
      )}
    </Card>
  );
}
