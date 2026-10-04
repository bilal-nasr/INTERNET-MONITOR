import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "@/lib/db";
import { getCycleUsage } from "@/lib/stats";

/**
 * getCycleUsage is one aggregate plus arithmetic. The aggregate is mocked to a
 * fixed total so what is asserted is the arithmetic, and in particular the
 * digest's `atCycleEnd` option: the closed-cycle report is built one
 * millisecond before the boundary, and must describe a finished cycle.
 */
vi.mock("@/lib/db", () => ({ db: { one: vi.fn() } }));

const one = vi.mocked(db.one);

/** Stand-in for the cycle aggregate's row: the total and its free-hours part. */
function summaryRow(totalBytes: number, freeBytes = 0) {
  return { total_bytes: totalBytes, free_bytes: freeBytes };
}

describe("getCycleUsage for the closed-cycle digest", () => {
  // A 31-day cycle, 1 August to 1 September UTC, with 620 GB used of 600.
  const boundary = new Date("2026-09-01T00:00:00Z");
  const reportAt = new Date(boundary.getTime() - 1);
  const used = 620e9;

  beforeEach(() => {
    one.mockReset().mockResolvedValue(summaryRow(used));
  });

  test("without the option, a millisecond before the boundary reads a day short", async () => {
    const cycle = await getCycleUsage(600, 1, "UTC", reportAt);
    expect([cycle.days_elapsed, cycle.days_total, cycle.days_remaining]).toEqual([30, 31, 1]);
    expect(cycle.daily_average_bytes).toBe(Math.round(used / 30));
  });

  test("with it, the cycle is reported whole", async () => {
    const cycle = await getCycleUsage(600, 1, "UTC", reportAt, { atCycleEnd: true });
    expect(cycle.start).toBe("2026-08-01T00:00:00.000Z");
    expect(cycle.end).toBe(boundary.toISOString());
    expect([cycle.days_elapsed, cycle.days_total, cycle.days_remaining]).toEqual([31, 31, 0]);
    // Averaged over every day of the month, not 30 of them.
    expect(cycle.daily_average_bytes).toBe(Math.round(used / 31));
    // A finished cycle's projection is what happened.
    expect(cycle.projected_bytes).toBe(used);
    expect(cycle.over).toBe(true);
  });

  test("the usage range still ends where the report was measured", async () => {
    await getCycleUsage(600, 1, "UTC", reportAt, { atCycleEnd: true });
    const params = one.mock.calls[0][1] as { from: Date; to: Date };
    // Only the progress arithmetic moves to the boundary, never the data read.
    expect(params.to.getTime()).toBe(reportAt.getTime());
    expect(params.from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  test("the option changes nothing about a live mid-cycle reading", async () => {
    const mid = new Date("2026-08-11T12:00:00Z");
    const live = await getCycleUsage(600, 1, "UTC", mid);
    const unset = await getCycleUsage(600, 1, "UTC", mid, {});
    expect(unset).toEqual(live);
    expect([live.days_elapsed, live.days_remaining]).toEqual([10, 21]);
  });
});

describe("getCycleUsage with free hours", () => {
  const mid = new Date("2026-08-11T12:00:00Z");

  beforeEach(() => {
    one.mockReset().mockResolvedValue(summaryRow(500e9, 200e9));
  });

  test("leaves the free traffic out of the cap and reports it on its own", async () => {
    const cycle = await getCycleUsage(600, 1, "UTC", mid, { free: { start: "02:00", end: "07:59" } });
    expect(cycle.used_bytes).toBe(300e9);
    expect(cycle.percent_of_cap).toBe(50);
    expect(cycle.over).toBe(false);
    expect(cycle.free).toEqual({ start: "02:00", end: "07:59", bytes: 200e9 });
  });

  test("passes the window to the query as seconds, end exclusive", async () => {
    await getCycleUsage(600, 1, "Asia/Beirut", mid, { free: { start: "23:00", end: "06:59" } });
    const params = one.mock.calls[0][1] as Record<string, unknown>;
    expect(params).toMatchObject({ freeStart: 82_800, freeEnd: 25_200, timezone: "Asia/Beirut" });
  });

  test("without free hours there is no free figure and nothing is asked for", async () => {
    one.mockResolvedValue(summaryRow(500e9));
    const cycle = await getCycleUsage(600, 1, "UTC", mid);
    expect(cycle.used_bytes).toBe(500e9);
    expect(cycle.free).toBeNull();
    const params = one.mock.calls[0][1] as Record<string, unknown>;
    expect(params).toMatchObject({ freeStart: null, freeEnd: null });
  });
});
