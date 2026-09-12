import type { DeviceSeriesPoint } from "@/lib/devices/usage";
import { bytesToGb } from "@/lib/format";

export const TOP_DEVICES = 8;
/** Column name for everything outside the top list; no MAC can collide with it. */
export const OTHERS_KEY = "__others__";

export interface StackedRow {
  bucket: string;
  [mac: string]: number | string;
}

/**
 * Pivot per-device points into one row per bucket for a stacked chart. Every
 * top MAC gets a column in every row, zero when the device was quiet, so the
 * stack never shifts colours between neighbouring bars.
 */
export function stackDeviceSeries(points: DeviceSeriesPoint[], topMacs: string[]): StackedRow[] {
  const top = new Set(topMacs);
  const rows = new Map<string, StackedRow>();
  for (const p of points) {
    let row = rows.get(p.bucket);
    if (!row) {
      row = { bucket: p.bucket, [OTHERS_KEY]: 0 };
      for (const mac of topMacs) row[mac] = 0;
      rows.set(p.bucket, row);
    }
    const key = top.has(p.mac) ? p.mac : OTHERS_KEY;
    row[key] = (row[key] as number) + bytesToGb(p.total_bytes);
  }
  return [...rows.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
}
