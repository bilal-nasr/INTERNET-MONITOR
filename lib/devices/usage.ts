/**
 * Per-device traffic, aggregated in Postgres.
 *
 * The rule is the one every WAN statistic uses (see lib/stats.ts): usage
 * between two consecutive readings is the growth of the counter, or the whole
 * new value when the counter went backwards. Deltas are taken within one MAC.
 */

import { db } from "@/lib/db";
import { OTHERS_KEY } from "@/lib/devices/chart";
import type { BucketUnit } from "@/lib/range";
import type { RangeParams } from "@/lib/stats";

const LOOKBACK = "INTERVAL '1 hour'";

/** Per-reading deltas per device, as CTEs `r` and `d`; pg-promise named parameters. */
const DEVICE_DELTAS = `
  r AS (
    SELECT mac, recorded_at, tx_bytes, rx_bytes,
           LAG(tx_bytes) OVER w AS prev_tx,
           LAG(rx_bytes) OVER w AS prev_rx
    FROM device_readings
    WHERE (\${from} IS NULL OR recorded_at >= \${from}::timestamptz - ${LOOKBACK})
      AND recorded_at < \${to}::timestamptz
    WINDOW w AS (PARTITION BY mac ORDER BY recorded_at, id)
  ),
  d AS (
    SELECT mac, recorded_at,
           CASE WHEN prev_tx IS NULL THEN 0
                WHEN tx_bytes >= prev_tx THEN tx_bytes - prev_tx
                ELSE tx_bytes END AS tx_delta,
           CASE WHEN prev_rx IS NULL THEN 0
                WHEN rx_bytes >= prev_rx THEN rx_bytes - prev_rx
                ELSE rx_bytes END AS rx_delta
    FROM r
    WHERE (\${from} IS NULL OR recorded_at >= \${from}::timestamptz)
  )`;

export interface DeviceUsage {
  mac: string;
  /** What the page shows: the owner's name, else the DHCP hostname, else the MAC. */
  label: string;
  hostname: string | null;
  ip: string | null;
  last_seen: string;
  tx_bytes: number;
  rx_bytes: number;
  total_bytes: number;
  readings: number;
}

interface DeviceUsageRow extends Omit<DeviceUsage, "last_seen"> {
  last_seen: Date;
}

export async function getDeviceUsage(range: RangeParams, limit = 50): Promise<DeviceUsage[]> {
  const rows = await db.any<DeviceUsageRow>(
    `WITH ${DEVICE_DELTAS}
     SELECT d.mac,
            COALESCE(dv.name, dv.hostname, d.mac)      AS label,
            dv.hostname, dv.ip, dv.last_seen,
            COALESCE(SUM(tx_delta), 0)::bigint          AS tx_bytes,
            COALESCE(SUM(rx_delta), 0)::bigint          AS rx_bytes,
            COALESCE(SUM(tx_delta + rx_delta), 0)::bigint AS total_bytes,
            COUNT(*)::int                               AS readings
     FROM d
     JOIN devices dv ON dv.mac = d.mac
     GROUP BY d.mac, dv.name, dv.hostname, dv.ip, dv.last_seen
     ORDER BY total_bytes DESC, d.mac
     LIMIT \${limit}`,
    { from: range.from, to: range.to, limit },
  );
  return rows.map((r) => ({ ...r, last_seen: r.last_seen.toISOString() }));
}

export interface DeviceRangeTotals {
  /** Every device with a reading in the range, not just the page shown. */
  devices: number;
  total_bytes: number;
}

/**
 * The totals the page's tiles state. Deliberately not derived from the rows of
 * getDeviceUsage: those stop at the limit, so on a LAN with more devices than
 * one page holds, summing them understates the total and inflates the busiest
 * device's share of it, while both are presented as figures for the whole
 * range. This is the same aggregate without the LIMIT.
 */
export function getDeviceRangeTotals(range: RangeParams): Promise<DeviceRangeTotals> {
  return db.one<DeviceRangeTotals>(
    `WITH ${DEVICE_DELTAS}
     SELECT COUNT(DISTINCT mac)::int                     AS devices,
            COALESCE(SUM(tx_delta + rx_delta), 0)::bigint AS total_bytes
     FROM d`,
    { from: range.from, to: range.to },
  );
}

export interface DeviceSeriesPoint {
  mac: string;
  /** Start of the bucket as local wall-clock time, "YYYY-MM-DDTHH:MM:SS". */
  bucket: string;
  total_bytes: number;
  tx_bytes: number;
  rx_bytes: number;
  readings: number;
}

/**
 * Bucketed traffic for the `top` busiest devices of the range, each under its
 * own MAC, and every other device folded into one series under OTHERS_KEY.
 * Buckets with no readings are absent.
 *
 * The busiest devices are ranked here, in the same order getDeviceUsage lists
 * them, so the page can run both queries at once instead of waiting for the
 * table before it can ask for the chart. Folding the rest in the database keeps
 * the result at most `top + 1` rows per bucket however many devices there are.
 */
export function getDeviceSeries(
  range: RangeParams,
  bucket: BucketUnit,
  timezone: string,
  top: number,
): Promise<DeviceSeriesPoint[]> {
  return db.any<DeviceSeriesPoint>(
    `WITH ${DEVICE_DELTAS},
     top AS (
       SELECT mac FROM d
       GROUP BY mac
       ORDER BY COALESCE(SUM(tx_delta + rx_delta), 0) DESC, mac
       LIMIT \${top}
     )
     SELECT CASE WHEN d.mac IN (SELECT mac FROM top) THEN d.mac ELSE \${others} END AS mac,
            to_char(date_trunc(\${bucket}, recorded_at AT TIME ZONE \${timezone}),
                    'YYYY-MM-DD"T"HH24:MI:SS')          AS bucket,
            COALESCE(SUM(tx_delta + rx_delta), 0)::bigint AS total_bytes,
            COALESCE(SUM(tx_delta), 0)::bigint          AS tx_bytes,
            COALESCE(SUM(rx_delta), 0)::bigint          AS rx_bytes,
            COUNT(*)::int                               AS readings
     FROM d
     GROUP BY 1, 2
     ORDER BY 2, 1`,
    { from: range.from, to: range.to, bucket, timezone, top, others: OTHERS_KEY },
  );
}

export interface DeviceRow {
  mac: string;
  name: string | null;
  hostname: string | null;
  ip: string | null;
  first_seen: Date;
  last_seen: Date;
}

/** Null when no such device exists. An empty name clears the label. */
export function renameDevice(mac: string, name: string | null): Promise<DeviceRow | null> {
  return db.oneOrNone<DeviceRow>(
    "UPDATE devices SET name = $2 WHERE mac = $1 RETURNING *",
    [mac, name],
  );
}
