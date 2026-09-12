import { describe, expect, test } from "vitest";
import {
  clampDayToMonth,
  closedCycleProgress,
  cycleBounds,
  cycleProgress,
  projectCycleUsage,
} from "@/lib/billing";

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

/**
 * The closed-cycle digest builds its report one millisecond before the cycle
 * boundary, and the shared, floored `cycleProgress` reads that instant as a
 * day short. `closedCycleProgress` is what getCycleUsage's `atCycleEnd` option
 * uses, for the digest alone; `cycleProgress` itself is deliberately unchanged,
 * because the dashboard and the cap alerts ask the live question.
 */
describe("closedCycleProgress", () => {
  // August has 31 days, so a cycle anchored on the 1st is 31 days long.
  const start = new Date("2026-08-01T00:00:00Z");
  const end = new Date("2026-09-01T00:00:00Z");

  test("the live reading a millisecond before the boundary is a day short (the bug)", () => {
    const p = cycleProgress(new Date(end.getTime() - 1), start, end);
    expect([p.days_elapsed, p.days_total, p.days_remaining]).toEqual([30, 31, 1]);
  });

  test("a finished cycle has used every one of its days", () => {
    expect(closedCycleProgress(start, end)).toEqual({
      days_total: 31,
      days_elapsed: 31,
      days_remaining: 0,
      fraction: 1,
    });
  });

  test("still closes on a whole cycle when spring DST makes it an hour short", () => {
    // Beirut springs forward in late March: 1 March to 1 April local is 31 days
    // less an hour. Evaluating cycleProgress at the end floors that to 30.
    const { start: s, end: e } = cycleBounds(new Date("2026-03-15T12:00:00Z"), 1, beirut);
    expect(cycleProgress(e, s, e).days_elapsed).toBe(30);
    expect(closedCycleProgress(s, e)).toMatchObject({ days_total: 31, days_elapsed: 31, days_remaining: 0 });
  });

  test("and when autumn DST makes it an hour long", () => {
    const { start: s, end: e } = cycleBounds(new Date("2026-10-15T12:00:00Z"), 1, beirut);
    expect(closedCycleProgress(s, e)).toMatchObject({ days_total: 31, days_elapsed: 31, days_remaining: 0 });
  });

  test("leaves the live arithmetic alone", () => {
    // The gauge and the cap alerts read this; the contained fix must not move it.
    const p = cycleProgress(new Date("2026-08-11T12:00:00Z"), start, end);
    expect([p.days_elapsed, p.days_remaining]).toEqual([10, 21]);
  });
});
