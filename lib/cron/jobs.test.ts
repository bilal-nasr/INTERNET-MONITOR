import { describe, expect, test } from "vitest";
import { JOBS, registerJob, type Job, type JobResult } from "@/lib/cron/jobs";

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
