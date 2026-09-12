/**
 * Thinning: old readings collapse to one per hour.
 *
 * Readings arrive every 30 seconds, so a year is over a million rows. Once a
 * day this keeps the newest reading of every (interface, hour) older than the
 * retention cutoff and deletes the rest. Traffic figures are the growth of the
 * counter from one reading to the next, so the surviving deltas still add up
 * to the same totals; what is lost is minute-level detail for old dates.
 *
 * When it runs (at most daily) and what the cutoff is live in lib/retention.ts,
 * which is pure and unit-tested; the SQL below is the plumbing.
 */

import { registerJob, type Job, type JobContext, type JobResult } from "@/lib/cron/jobs";
import { getJobRun } from "@/lib/cron/runs";
import { db } from "@/lib/db";
import { isThinDue, MAX_DAYS_PER_TICK, thinningCutoff } from "@/lib/retention";

/**
 * Days (UTC, truncated) before the cutoff that still hold more than one
 * reading in some hour, oldest first. A day already thinned has at most one
 * row per interface per hour and never comes back, so progress needs no
 * cursor: each tick simply takes the next batch of unthinned days.
 */
const DAYS_TO_THIN = `
  SELECT date_trunc('day', hour) AS day
  FROM (
    SELECT date_trunc('hour', recorded_at) AS hour, COUNT(*) AS n
    FROM interface_readings
    WHERE recorded_at < $1::timestamptz
    GROUP BY interface_name, date_trunc('hour', recorded_at)
  ) h
  WHERE n > 1
  GROUP BY day
  ORDER BY day
  LIMIT $2`;

/**
 * Within one day, delete every reading that is not the newest of its
 * (interface, hour). The day is clipped to the cutoff, which is hour-aligned,
 * so an hour is never split between kept and deleted.
 */
const THIN_DAY = `
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY interface_name, date_trunc('hour', recorded_at)
             ORDER BY recorded_at DESC, id DESC
           ) AS rn
    FROM interface_readings
    WHERE recorded_at >= $1::timestamptz
      AND recorded_at <  LEAST($1::timestamptz + INTERVAL '1 day', $2::timestamptz)
  )
  DELETE FROM interface_readings
  WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`;

/** The same two statements for per-device readings, partitioned by mac. */
const DEVICE_DAYS_TO_THIN = `
  SELECT date_trunc('day', hour) AS day
  FROM (
    SELECT date_trunc('hour', recorded_at) AS hour, COUNT(*) AS n
    FROM device_readings
    WHERE recorded_at < $1::timestamptz
    GROUP BY mac, date_trunc('hour', recorded_at)
  ) h
  WHERE n > 1
  GROUP BY day
  ORDER BY day
  LIMIT $2`;

const THIN_DEVICE_DAY = `
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY mac, date_trunc('hour', recorded_at)
             ORDER BY recorded_at DESC, id DESC
           ) AS rn
    FROM device_readings
    WHERE recorded_at >= $1::timestamptz
      AND recorded_at <  LEAST($1::timestamptz + INTERVAL '1 day', $2::timestamptz)
  )
  DELETE FROM device_readings
  WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`;

async function thinTable(
  daysSql: string,
  daySql: string,
  cutoff: Date,
): Promise<{ days: number; deleted: number }> {
  const days = await db.any<{ day: Date }>(daysSql, [cutoff, MAX_DAYS_PER_TICK]);
  let deleted = 0;
  for (const { day } of days) {
    const result = await db.result(daySql, [day, cutoff]);
    deleted += result.rowCount;
  }
  return { days: days.length, deleted };
}

/** Per-device readings are a separate feature; the table is thinned only when it exists. */
async function deviceTableExists(): Promise<boolean> {
  const row = await db.one<{ present: boolean }>("SELECT to_regclass('device_readings') IS NOT NULL AS present");
  return row.present;
}

async function run({ now, settings }: JobContext): Promise<JobResult> {
  const last = await getJobRun("thinReadings");
  if (!isThinDue(last?.last_run_at ?? null, now)) {
    return { status: "skipped", detail: "ran within the last 24 h" };
  }

  const cutoff = thinningCutoff(now, settings.retention_days);
  const readings = await thinTable(DAYS_TO_THIN, THIN_DAY, cutoff);
  const devices = (await deviceTableExists())
    ? await thinTable(DEVICE_DAYS_TO_THIN, THIN_DEVICE_DAY, cutoff)
    : { days: 0, deleted: 0 };

  const more = readings.days === MAX_DAYS_PER_TICK || devices.days === MAX_DAYS_PER_TICK;
  return {
    status: "ok",
    detail:
      `deleted ${readings.deleted} readings over ${readings.days} days` +
      `, ${devices.deleted} device readings over ${devices.days} days` +
      `, cutoff ${cutoff.toISOString()}` +
      (more ? ", more remain for the next run" : ""),
  };
}

export const thinReadings: Job = { name: "thinReadings", run };

registerJob(thinReadings);
