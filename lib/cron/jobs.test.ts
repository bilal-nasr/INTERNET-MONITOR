import { beforeEach, describe, expect, test, vi } from "vitest";
import { JOBS, registerJob, type Job, type JobContext, type JobResult } from "@/lib/cron/jobs";
import { claimTick, recordJobRun } from "@/lib/cron/runs";
import { runTick } from "@/lib/cron/tick";
import { getSettings, type SettingsRow } from "@/lib/settings";

/**
 * The only two things runTick touches that need a database: the job_runs
 * read/write module and getSettings. Everything else in the test is a real
 * object - the registry, the jobs, the report - so what is asserted below is
 * runTick's own behaviour and not a mock's.
 */
vi.mock("@/lib/cron/runs", () => ({
  claimTick: vi.fn(),
  recordJobRun: vi.fn(),
  getJobRun: vi.fn(),
}));

vi.mock("@/lib/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings")>()),
  getSettings: vi.fn(),
}));

const SETTINGS = { timezone: "Asia/Beirut" } as unknown as SettingsRow;

function job(name: string, result: JobResult = { status: "ok" }): Job {
  return { name, run: async () => result };
}

describe("registerJob", () => {
  test("registering two different jobs keeps both, in registration order", () => {
    JOBS.length = 0;
    const a = job("a");
    const b = job("b");

    registerJob(a);
    registerJob(b);

    expect(JOBS).toEqual([a, b]);
  });

  test("registering the same name twice keeps one entry: the newer implementation", () => {
    JOBS.length = 0;
    const original = job("stale", { status: "ok", detail: "original" });
    const reloaded = job("stale", { status: "ok", detail: "reloaded" });

    registerJob(original);
    registerJob(reloaded);

    expect(JOBS).toHaveLength(1);
    expect(JOBS[0]).toBe(reloaded);
  });

  test("re-registering a name preserves its original position, not run order", () => {
    JOBS.length = 0;
    const a = job("a");
    const b = job("b");
    const c = job("c");
    const reloadedA = job("a", { status: "ok", detail: "reloaded" });

    registerJob(a);
    registerJob(b);
    registerJob(c);
    registerJob(reloadedA);

    expect(JOBS).toEqual([reloadedA, b, c]);
    expect(JOBS[0]).toBe(reloadedA);
  });
});

describe("runTick", () => {
  beforeEach(() => {
    JOBS.length = 0;
    vi.mocked(claimTick).mockReset().mockResolvedValue(true);
    vi.mocked(recordJobRun).mockReset().mockResolvedValue(undefined);
    vi.mocked(getSettings).mockReset().mockResolvedValue(SETTINGS);
  });

  test("runs every job with the clock and the settings, and records what they did", async () => {
    const seen: JobContext[] = [];
    registerJob({ name: "a", run: async (ctx) => (seen.push(ctx), { status: "ok", detail: "did a" }) });
    const now = new Date("2026-09-14T05:00:00.000Z");

    const result = await runTick(now);

    expect(seen).toEqual([{ now, settings: SETTINGS }]);
    expect(result.ran_at).toBe(now.toISOString());
    expect(result.jobs.map((j) => ({ name: j.name, status: j.status, detail: j.detail }))).toEqual([
      { name: "a", status: "ok", detail: "did a" },
    ]);
    expect(recordJobRun).toHaveBeenCalledWith("a", "ok", "did a", now);
  });

  test("a job that throws is reported as failed and does not stop the next one", async () => {
    registerJob({
      name: "thrower",
      run: async () => {
        throw new Error("aggregate timed out");
      },
    });
    registerJob(job("after", { status: "ok", detail: "ran anyway" }));
    const now = new Date("2026-09-14T05:00:00.000Z");

    const result = await runTick(now);

    expect(result.jobs.map((j) => [j.name, j.status, j.detail])).toEqual([
      ["thrower", "failed", "aggregate timed out"],
      ["after", "ok", "ran anyway"],
    ]);
    // The failure is state worth keeping: it goes into job_runs like any work.
    expect(recordJobRun).toHaveBeenCalledWith("thrower", "failed", "aggregate timed out", now);
    expect(recordJobRun).toHaveBeenCalledWith("after", "ok", "ran anyway", now);
  });

  test("a skip is reported but never written to job_runs", async () => {
    registerJob(job("skipper", { status: "skipped", detail: "nothing to do" }));
    registerJob(job("worker", { status: "ok", detail: "sent" }));

    const result = await runTick(new Date("2026-09-14T05:00:00.000Z"));

    expect(result.jobs[0]).toMatchObject({ name: "skipper", status: "skipped", detail: "nothing to do" });
    expect(recordJobRun).toHaveBeenCalledTimes(1);
    expect(recordJobRun).toHaveBeenCalledWith("worker", "ok", "sent", expect.any(Date));
  });

  test("a failure to record a run does not fail the tick or the jobs after it", async () => {
    vi.mocked(recordJobRun).mockRejectedValue(new Error("job_runs is unreachable"));
    registerJob(job("a", { status: "ok", detail: "one" }));
    registerJob(job("b", { status: "ok", detail: "two" }));

    const result = await runTick(new Date("2026-09-14T05:00:00.000Z"));

    expect(result.jobs.map((j) => j.name)).toEqual(["a", "b"]);
  });

  test("the tick that loses the lease does nothing at all", async () => {
    // Two triggers firing at once: the second tick's claim finds the lease
    // held and must not run a single job, or the user gets the same mail
    // twice.
    vi.mocked(claimTick).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    let runs = 0;
    registerJob({ name: "mailer", run: async () => (runs += 1, { status: "ok", detail: "sent" }) });
    const now = new Date("2026-09-14T05:00:00.000Z");

    const [first, second] = await Promise.all([runTick(now), runTick(now)]);

    expect(runs).toBe(1);
    expect(first.jobs).toHaveLength(1);
    expect(second.jobs).toEqual([]);
    expect(second.ran_at).toBe(now.toISOString());
    expect(recordJobRun).toHaveBeenCalledTimes(1);
  });

  test("the lease is claimed before anything else the tick does", async () => {
    vi.mocked(claimTick).mockResolvedValue(false);
    registerJob(job("mailer"));

    await runTick(new Date("2026-09-14T05:00:00.000Z"));

    // Not even the settings are read: a tick that cannot claim is over.
    expect(getSettings).not.toHaveBeenCalled();
  });
});
