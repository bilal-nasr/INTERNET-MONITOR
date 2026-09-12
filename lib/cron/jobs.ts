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
