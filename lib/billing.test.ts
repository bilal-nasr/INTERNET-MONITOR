import { describe, expect, test } from "vitest";
import { clampDayToMonth, cycleBounds, cycleProgress, projectCycleUsage } from "@/lib/billing";

const utc = "UTC";
const beirut = "Asia/Beirut";

describe("clampDayToMonth", () => {
  test("leaves a day that exists in the month untouched", () => {
    expect(clampDayToMonth(2026, 9, 5)).toBe(5);
  });

  test("clamps the 31st to the last day of a 30-day month", () => {
    expect(clampDayToMonth(2026, 4, 31)).toBe(30);
  });

  test("clamps the 31st to 28 in a common-year February", () => {
    expect(clampDayToMonth(2026, 2, 31)).toBe(28);
  });

  test("clamps the 31st to 29 in a leap-year February", () => {
    expect(clampDayToMonth(2024, 2, 31)).toBe(29);
  });
});

describe("cycleBounds", () => {
  test("starts on this month's cycle day once it has passed", () => {
    const { start, end } = cycleBounds(new Date("2026-09-11T10:00:00Z"), 5, utc);
    expect(start.toISOString()).toBe("2026-09-05T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  test("falls back to last month's cycle day before this month's arrives", () => {
    const { start, end } = cycleBounds(new Date("2026-09-03T10:00:00Z"), 5, utc);
    expect(start.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });

  test("treats local midnight on the cycle day as the start of the new cycle", () => {
    const { start } = cycleBounds(new Date("2026-09-05T00:00:00Z"), 5, utc);
    expect(start.toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });

  test("clamps a 31st cycle day to the last day of a short month", () => {
    const { start, end } = cycleBounds(new Date("2026-04-15T10:00:00Z"), 31, utc);
    expect(start.toISOString()).toBe("2026-03-31T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });

  test("anchors the boundary on local midnight in the settings timezone", () => {
    const { start } = cycleBounds(new Date("2026-09-11T10:00:00Z"), 5, beirut);
    // Beirut is UTC+3 in September, so local midnight is 21:00 the day before.
    expect(start.toISOString()).toBe("2026-09-04T21:00:00.000Z");
  });

  test("crosses the year boundary backwards from January", () => {
    const { start, end } = cycleBounds(new Date("2026-01-02T10:00:00Z"), 5, utc);
    expect(start.toISOString()).toBe("2025-12-05T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  test("returns an earlier cycle when an offset is given", () => {
    const { start, end } = cycleBounds(new Date("2026-09-11T10:00:00Z"), 5, utc, -1);
    expect(start.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });
});

describe("cycleProgress", () => {
  const start = new Date("2026-09-05T00:00:00Z");
  const end = new Date("2026-10-05T00:00:00Z");

  test("reports whole days elapsed and the remaining fraction", () => {
    const p = cycleProgress(new Date("2026-09-15T00:00:00Z"), start, end);
    expect(p.days_total).toBe(30);
    expect(p.days_elapsed).toBe(10);
    expect(p.days_remaining).toBe(20);
    expect(p.fraction).toBeCloseTo(10 / 30, 6);
  });

  test("clamps to the cycle end once the cycle is over", () => {
    const p = cycleProgress(new Date("2026-10-20T00:00:00Z"), start, end);
    expect(p.fraction).toBe(1);
    expect(p.days_remaining).toBe(0);
  });

  test("reports a zero fraction at the exact start", () => {
    const p = cycleProgress(start, start, end);
    expect(p.fraction).toBe(0);
    expect(p.days_elapsed).toBe(0);
  });
});

describe("projectCycleUsage", () => {
  const start = new Date("2026-09-05T00:00:00Z");
  const end = new Date("2026-10-05T00:00:00Z");

  test("extrapolates the current burn rate to the end of the cycle", () => {
    const projected = projectCycleUsage(100, new Date("2026-09-15T00:00:00Z"), start, end);
    expect(projected).toBe(300);
  });

  test("returns the actual total once the cycle has ended", () => {
    const projected = projectCycleUsage(250, new Date("2026-10-06T00:00:00Z"), start, end);
    expect(projected).toBe(250);
  });

  test("returns zero at the exact start rather than dividing by zero", () => {
    expect(projectCycleUsage(0, start, start, end)).toBe(0);
  });
});
