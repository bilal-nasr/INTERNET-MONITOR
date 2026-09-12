import { db } from "@/lib/db";

export interface JobRun {
  job: string;
  last_run_at: Date;
  last_status: string;
  last_detail: string | null;
}

export function getJobRun(name: string): Promise<JobRun | null> {
  return db.oneOrNone<JobRun>("SELECT job, last_run_at, last_status, last_detail FROM job_runs WHERE job = $1", [
    name,
  ]);
}

export async function recordJobRun(
  name: string,
  status: string,
  detail: string | null,
  at = new Date(),
): Promise<void> {
  await db.none(
    `INSERT INTO job_runs (job, last_run_at, last_status, last_detail)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (job) DO UPDATE
       SET last_run_at = EXCLUDED.last_run_at,
           last_status = EXCLUDED.last_status,
           last_detail = EXCLUDED.last_detail`,
    [name, at, status, detail],
  );
}
