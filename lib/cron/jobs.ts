/**
 * The jobs /api/cron/tick runs, in order.
 *
 * A job must be safe to run every minute: it reads its own state (job_runs,
 * the alerts log, the readings) and returns "skipped" when there is nothing to
 * do. It must never throw for an expected condition; the tick catches what it
 * does throw and records it as "failed" without stopping the jobs after it.
 */

import type { SettingsRow } from "@/lib/settings";

export interface JobContext {
  now: Date;
  settings: SettingsRow;
}

export interface JobResult {
  status: "ok" | "failed" | "skipped";
  detail?: string | null;
}

export interface Job {
  name: string;
  run(ctx: JobContext): Promise<JobResult>;
}

/** Filled in by the modules that define jobs (stale, digest, and later thinning). */
export const JOBS: Job[] = [];

/**
 * Register a job. A job module is not guaranteed to be evaluated exactly
 * once - dev-server hot reload re-evaluates an edited module, and a module
 * can legitimately end up in more than one bundle or runtime context - so
 * registration must be idempotent rather than assume single evaluation.
 *
 * If a job with the same name is already registered, this REPLACES it in
 * place, keeping its original position in the array. That keeps the run
 * order (which lib/cron/tick.ts fixes via import order) stable across
 * re-registrations, while making sure a hot-reloaded module's newer
 * implementation is what actually runs - silently ignoring the second
 * registration would leave the stale pre-edit implementation running on
 * every tick after the edit.
 */
export function registerJob(job: Job): void {
  const existing = JOBS.findIndex((j) => j.name === job.name);
  if (existing === -1) {
    JOBS.push(job);
  } else {
    JOBS[existing] = job;
  }
}
