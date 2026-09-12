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

/** Stand-in for getRangeSummary's row: only the total matters here. */
function summaryRow(totalBytes: number) {
  return {
    readings: 1,
    total_bytes: totalBytes,
    tx_bytes: 0,
    rx_bytes: totalBytes,
    first_reading_at: null,
    last_reading_at: null,
    measured_seconds: 0,
    peak_bytes_per_second: 0,
  };
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
