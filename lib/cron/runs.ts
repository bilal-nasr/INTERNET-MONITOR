import { db } from "@/lib/db";

export interface JobRun {
  job: string;
  last_run_at: Date;
  last_status: string;
  last_detail: string | null;
}

/**
 * The name the tick leases for itself in `job_runs`.
 *
 * `job_runs` is keyed by `Job.name` from lib/cron/jobs.ts ("stale",
 * "digest"), and the tick is the runner rather than a job: it is never
 * registered with registerJob and never appears in JOBS, so this row cannot
 * collide with a real job's row. Keeping the lease in the same table is
 * deliberate - it already exists, it is already written on every tick, and a
 * single conditional UPDATE on a primary key is one round trip.
 */
const TICK_JOB = "tick";

/** What the lease row says when nothing has claimed it yet, so `SELECT * FROM job_runs` explains itself. */
const TICK_LEASE_DETAIL = "lease row for /api/cron/tick itself; not a job";

/**
 * How long a claimed tick keeps the next one out.
 *
 * Chosen between two bounds:
 *  - it must comfortably exceed a normal tick's duration, or a second trigger
 *    firing while the first tick is still deciding could claim as well and
 *    mail the same person twice. A tick that does work is a handful of
 *    Supabase round trips (~85 ms each) plus one Resend call: well under a
 *    second in practice, a second or two at worst.
 *  - it must stay well under the tightest trigger interval, which is the 60 s
 *    curl loop in docker-compose.yml. A lease at or above 60 s would drop
 *    every other run of that loop the moment the interval drifted, and the
 *    stale alert would then be checked half as often as configured. Half the
 *    interval leaves room for that drift.
 *
 * 30 s satisfies both. It is not a mutex: a tick that somehow ran longer than
 * the lease would let a second one in, which is why the jobs keep their own
 * per-job guards (the alerts log, and the job_runs backstop) as well.
 */
const TICK_LEASE_MS = 30_000;

export function getJobRun(name: string): Promise<JobRun | null> {
  return db.oneOrNone<JobRun>("SELECT job, last_run_at, last_status, last_detail FROM job_runs WHERE job = $1", [
    name,
  ]);
}

/**
 * Claim the right to run this tick, returning false when another tick already
 * holds the lease.
 *
 * Three triggers are supported at once (Vercel cron, a GitHub Actions
 * schedule, the compose curl loop) and the README recommends running two of
 * them together, so overlapping ticks are the normal case rather than a race
 * to be hand-waved away. Without this, two ticks that start within a second of
 * each other both read "no digest sent yet", both spend ~500 ms building the
 * report, and both call Resend: the user gets the same mail twice.
 *
 * One statement is the claim. Postgres serialises the two ticks on the row
 * lock and only the one that finds `last_run_at` older than the lease window
 * gets a row back; the loser sees zero rows and does nothing. The INSERT is the
 * same claim on a fresh database, where there is no row yet to conflict with -
 * folded in rather than run first, because bootstrapping a row that exists
 * cost every tick a second round trip for ever.
 *
 * Both sides of the comparison are the database's `now()`, and so is what is
 * written. `now()` is fixed for the statement, so the lease is measured against
 * the same clock that stamped it. Passing the caller's clock instead - which is
 * what this used to do - subtracted any skew between serverless instances
 * straight out of the lease window: an instance running a few seconds fast
 * stamped a lease into the future, and one running slow could find a lease it
 * should have been shut out by already expired and run a second tick alongside
 * the first. There is no clock here to skew any more.
 */
export async function claimTick(): Promise<boolean> {
  const claimed = await db.oneOrNone<{ job: string }>(
    `INSERT INTO job_runs (job, last_run_at, last_status, last_detail)
     VALUES ($1, now(), 'pending', $2)
     ON CONFLICT (job) DO UPDATE
        SET last_run_at = now()
      WHERE job_runs.last_run_at < now() - ($3::double precision * INTERVAL '1 millisecond')
     RETURNING job`,
    [TICK_JOB, TICK_LEASE_DETAIL, TICK_LEASE_MS],
  );

  return claimed !== null;
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
