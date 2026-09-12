/**
 * Thinning: old readings collapse to one per hour.
 *
 * Readings arrive every 30 seconds, so a year is over a million rows. Once a
 * day this keeps the newest reading of every (interface, hour) older than the
 * retention cutoff and deletes the rest. Traffic figures are the growth of the
 * counter from one reading to the next, so the surviving deltas still add up
 * to the same totals; what is lost is minute-level detail for old dates. The
 * same is done per MAC for device_readings, and devices that have not been
 * heard from since the cutoff are dropped with them.
 *
 * When it runs, what the cutoff is and the statements themselves all live in
 * lib/retention.ts, which is pure and unit-tested; this file is the plumbing.
 *
 * Two things bound a run, because these are the most destructive statements in
 * the codebase and the first one ever to run meets a backlog:
 *
 *   * a day cap and a wall-clock budget, so a tick stops on its own well
 *     inside the route's maxDuration instead of being killed part way;
 *   * a dry run. `thinOnce(cutoff, { dryRun: true })` executes the read-only
 *     twin of every statement -- same rows, same predicates, COUNT(*) instead
 *     of the DELETE -- so the numbers can be checked before a row is removed:
 *
 *       import { thinOnce } from "@/lib/cron/thin";
 *       import { thinningCutoff } from "@/lib/retention";
 *       await thinOnce(thinningCutoff(new Date(), 90), { dryRun: true });
 */

import { registerJob, type Job, type JobContext, type JobResult } from "@/lib/cron/jobs";
import { getJobRun } from "@/lib/cron/runs";
import { db } from "@/lib/db";
import {
  DEVICE_TARGET,
  INTERFACE_TARGET,
  MAX_DAYS_PER_TICK,
  MAX_DEVICE_PRUNE_PER_TICK,
  THIN_TIME_BUDGET_MS,
  daysToThinSql,
  isThinBudgetSpent,
  isThinDue,
  pruneDevicesSql,
  thinDaySql,
  thinningCutoff,
  type ThinTarget,
} from "@/lib/retention";

export interface ThinOptions {
  /** Count what each statement would remove and remove nothing. */
  dryRun?: boolean;
  /** Wall-clock budget for the day loops; defaults to THIN_TIME_BUDGET_MS. */
  budgetMs?: number;
  /** Injectable clock, in milliseconds, so a caller can force the budget in a test. */
  clock?: () => number;
}

export interface ThinTableOutcome {
  /** Days actually processed, which is fewer than `days` found when the budget ran out. */
  days: number;
  /** Rows deleted, or -- on a dry run -- rows that would have been deleted. */
  deleted: number;
  /** True when the budget stopped the loop before every chosen day was done. */
  stoppedEarly: boolean;
}

export interface ThinOutcome {
  cutoff: string;
  dryRun: boolean;
  readings: ThinTableOutcome;
  devices: ThinTableOutcome;
  /** Device rows with nothing left inside the retention window. */
  devicesPruned: number;
  /** Whether work is left for the next run. */
  more: boolean;
}

interface Budget {
  dryRun: boolean;
  startedMs: number;
  budgetMs: number;
  clock: () => number;
}

async function thinTable(target: ThinTarget, cutoff: Date, budget: Budget): Promise<ThinTableOutcome> {
  const days = await db.any<{ day: Date }>(daysToThinSql(target), [cutoff, MAX_DAYS_PER_TICK]);
  const sql = thinDaySql(target, budget.dryRun ? "count" : "delete");

  let deleted = 0;
  let done = 0;
  for (const { day } of days) {
    if (isThinBudgetSpent(budget.startedMs, budget.clock(), budget.budgetMs)) {
      return { days: done, deleted, stoppedEarly: true };
    }
    if (budget.dryRun) {
      deleted += (await db.one<{ rows: number }>(sql, [day, cutoff])).rows;
    } else {
      deleted += (await db.result(sql, [day, cutoff])).rowCount;
    }
    done += 1;
  }
  return { days: done, deleted, stoppedEarly: false };
}

/** Per-device readings are a separate feature; the tables are touched only when they exist. */
async function deviceTablesExist(): Promise<boolean> {
  const row = await db.one<{ present: boolean }>(
    "SELECT to_regclass('device_readings') IS NOT NULL AND to_regclass('devices') IS NOT NULL AS present",
  );
  return row.present;
}

/** One pass of thinning. Exported so it can be dry-run against any database. */
export async function thinOnce(cutoff: Date, options: ThinOptions = {}): Promise<ThinOutcome> {
  const clock = options.clock ?? (() => Date.now());
  const budget: Budget = {
    dryRun: options.dryRun ?? false,
    startedMs: clock(),
    budgetMs: options.budgetMs ?? THIN_TIME_BUDGET_MS,
    clock,
  };

  const readings = await thinTable(INTERFACE_TARGET, cutoff, budget);

  let devices: ThinTableOutcome = { days: 0, deleted: 0, stoppedEarly: false };
  let devicesPruned = 0;
  if (await deviceTablesExist()) {
    devices = await thinTable(DEVICE_TARGET, cutoff, budget);
    // One bounded statement rather than a loop, so it runs even once the day
    // budget is spent: leaving it out would let stale device rows outlive every
    // tick on a database with a backlog.
    const prune = pruneDevicesSql(budget.dryRun ? "count" : "delete");
    const params = [cutoff, MAX_DEVICE_PRUNE_PER_TICK];
    devicesPruned = budget.dryRun
      ? (await db.one<{ rows: number }>(prune, params)).rows
      : (await db.result(prune, params)).rowCount;
  }

  return {
    cutoff: cutoff.toISOString(),
    dryRun: budget.dryRun,
    readings,
    devices,
    devicesPruned,
    more:
      readings.stoppedEarly ||
      devices.stoppedEarly ||
      readings.days === MAX_DAYS_PER_TICK ||
      devices.days === MAX_DAYS_PER_TICK ||
      devicesPruned === MAX_DEVICE_PRUNE_PER_TICK,
  };
}

export function describeThinOutcome(o: ThinOutcome): string {
  return (
    (o.dryRun ? "dry run: " : "") +
    `deleted ${o.readings.deleted} readings over ${o.readings.days} days` +
    `, ${o.devices.deleted} device readings over ${o.devices.days} days` +
    `, pruned ${o.devicesPruned} devices` +
    `, cutoff ${o.cutoff}` +
    (o.more ? ", more remain for the next run" : "")
  );
}

async function run({ now, settings }: JobContext): Promise<JobResult> {
  const last = await getJobRun("thinReadings");
  if (!isThinDue(last?.last_run_at ?? null, now)) {
    return { status: "skipped", detail: "ran within the last 24 h" };
  }

  const outcome = await thinOnce(thinningCutoff(now, settings.retention_days));
  return { status: "ok", detail: describeThinOutcome(outcome) };
}

export const thinReadings: Job = { name: "thinReadings", run };

registerJob(thinReadings);
