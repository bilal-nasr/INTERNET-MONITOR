import { JOBS, type JobResult } from "@/lib/cron/jobs";
import { recordJobRun } from "@/lib/cron/runs";
import { getSettings } from "@/lib/settings";

// Importing the job modules registers them. Order here is the run order.
import "@/lib/cron/stale";
import "@/lib/cron/digest";

export interface TickJobReport {
  name: string;
  status: JobResult["status"];
  detail: string | null;
  ms: number;
}

export interface TickResponse {
  ran_at: string;
  jobs: TickJobReport[];
}

/**
 * Run every registered job once, in sequence. A job that throws is recorded as
 * failed and the next one still runs: the stale check must not be lost because
 * the digest's aggregate timed out.
 *
 * "skipped" results are reported but not written to job_runs, so a row's
 * last_run_at is the last time the job actually did work (or failed). Jobs that
 * pace themselves from job_runs (plan 06's thinning) rely on this: with a
 * five-minute tick, recording skips would push last_run_at forward forever.
 */
export async function runTick(now = new Date()): Promise<TickResponse> {
  const settings = await getSettings();
  const jobs: TickJobReport[] = [];

  for (const job of JOBS) {
    const started = Date.now();
    let result: JobResult;
    try {
      result = await job.run({ now, settings });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[cron] ${job.name} failed:`, err);
      result = { status: "failed", detail };
    }
    const ms = Date.now() - started;
    if (result.status !== "skipped") {
      try {
        await recordJobRun(job.name, result.status, result.detail ?? null, now);
      } catch (err) {
        console.error(`[cron] could not record run of ${job.name}:`, err);
      }
    }
    jobs.push({ name: job.name, status: result.status, detail: result.detail ?? null, ms });
  }

  return { ran_at: now.toISOString(), jobs };
}
