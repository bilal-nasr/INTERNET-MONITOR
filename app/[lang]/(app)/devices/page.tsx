import type { Metadata } from "next";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DeviceChart } from "@/components/DeviceChart";
import { DeviceTable } from "@/components/DeviceTable";
import { RangePicker } from "@/components/RangePicker";
import { StatTiles, type Tile } from "@/components/stats/chrome";
import { stackDeviceSeries, TOP_DEVICES } from "@/lib/devices/chart";
import { getDeviceRangeTotals, getDeviceSeries, getDeviceUsage } from "@/lib/devices/usage";
import { formatBytes } from "@/lib/format";
import { fill, plural } from "@/lib/i18n";
import { Interpolate } from "@/lib/i18n/react";
import { getI18n } from "@/lib/i18n/server";
import { DEFAULT_PRESET, InvalidRangeError, rangeErrorMessage, resolveRange } from "@/lib/range";
import { getSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.devices.title} - ${d.meta.appName}` };
}

/** One page of devices, busiest first, so a long tail is what gets cut. */
const LIMIT = 50;

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export default async function DevicesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();

  const { locale, d } = await getI18n();
  const params = await searchParams;
  const settings = await getSettings();

  if (!settings.devices_enabled) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight">{d.devices.title}</h1>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold">{d.devices.disabledTitle}</h2>
          <p className="mt-2 text-sm text-muted">
            <Interpolate
              template={d.devices.disabledBody}
              values={{ setup: <code>devices-setup.rsc</code>, script: <code>devices-push</code> }}
            />
          </p>
        </section>
      </div>
    );
  }

  const options = { timezone: settings.timezone, cycleDay: settings.billing_cycle_day };
  let rangeError: string | null = null;
  let range;
  try {
    range = resolveRange(
      { range: one(params.range) ?? "today", from: one(params.from), to: one(params.to) },
      options,
    );
  } catch (err) {
    if (!(err instanceof InvalidRangeError)) throw err;
    rangeError = rangeErrorMessage(d, err);
    range = resolveRange({ range: DEFAULT_PRESET }, options);
  }

  const window = { from: range.from, to: range.to };
  // The tiles state figures for the whole range, so they come from an
  // aggregate over every device: the table below stops at LIMIT, and summing
  // its rows would quietly understate the total, and overstate the busiest
  // device's share of it, on any LAN with a longer tail than one page.
  const [devices, totals] = await Promise.all([
    getDeviceUsage(window, LIMIT),
    getDeviceRangeTotals(window),
  ]);
  // A minute-level bucket over a whole day is 1,440 stacks of eight; hours are
  // the finest the chart draws, whatever the range picker chose.
  const bucket = range.bucket === "minute" ? "hour" : range.bucket;
  const top = devices.slice(0, TOP_DEVICES);
  const series = await getDeviceSeries(
    devices.map((device) => device.mac),
    window,
    bucket,
    settings.timezone,
  );
  const rows = stackDeviceSeries(
    series,
    top.map((device) => device.mac),
  );
  const total = totals.total_bytes;
  const busiest = devices[0] ?? null;

  const tiles: Tile[] = [
    { label: d.devices.tiles.total, value: formatBytes(total) },
    { label: d.devices.tiles.devices, value: plural(locale, d.devices.devicesCount, totals.devices) },
    {
      label: d.devices.tiles.busiest,
      value: busiest ? busiest.label : d.common.empty,
      hint:
        busiest && total > 0
          ? `${Math.round((busiest.total_bytes / total) * 100)}% ${d.devices.tiles.share}`
          : undefined,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{d.devices.title}</h1>
          <p className="text-sm text-muted">{fill(d.devices.subtitle, { timezone: settings.timezone })}</p>
        </div>
        <AutoRefresh seconds={60} />
      </div>

      <RangePicker preset={range.preset} from={range.from_input} to={range.to_input} />

      {rangeError && (
        <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm">
          {fill(d.rangePicker.fallback, { reason: rangeError })}
        </p>
      )}

      <StatTiles tiles={tiles} columns={3} />

      <DeviceChart
        rows={rows}
        devices={top.map((device) => ({ mac: device.mac, label: device.label }))}
        bucket={bucket}
        hasOthers={devices.length > top.length}
      />

      <DeviceTable devices={devices} timezone={settings.timezone} />
    </div>
  );
}
