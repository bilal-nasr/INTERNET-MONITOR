import { describe, expect, test } from "vitest";
import { isThinDue, thinningCutoff, THIN_INTERVAL_MS } from "@/lib/retention";

describe("thinningCutoff", () => {
  test("is now minus the retention, truncated to the hour", () => {
    const now = new Date("2026-09-12T11:48:31.250Z");
    expect(thinningCutoff(now, 90).toISOString()).toBe("2026-06-14T11:00:00.000Z");
  });

  test("truncation drops minutes and seconds, never rounds up", () => {
    const now = new Date("2026-09-12T23:59:59.999Z");
    expect(thinningCutoff(now, 7).toISOString()).toBe("2026-09-05T23:00:00.000Z");
  });

  test("a whole-hour instant is unchanged", () => {
    const now = new Date("2026-09-12T10:00:00.000Z");
    expect(thinningCutoff(now, 1).toISOString()).toBe("2026-09-11T10:00:00.000Z");
  });
});

describe("isThinDue", () => {
  const now = new Date("2026-09-12T12:00:00Z");

  test("due when it has never run", () => {
    expect(isThinDue(null, now)).toBe(true);
  });

  test("not due within a day of the last run", () => {
    expect(isThinDue(new Date(now.getTime() - THIN_INTERVAL_MS + 1000), now)).toBe(false);
  });

  test("due once a full day has passed", () => {
    expect(isThinDue(new Date(now.getTime() - THIN_INTERVAL_MS), now)).toBe(true);
  });
});
