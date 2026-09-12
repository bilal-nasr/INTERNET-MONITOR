import { describe, expect, test } from "vitest";
import { previousLocalDate, windowSeconds } from "@/lib/time";

describe("windowSeconds", () => {
  test("converts the window to seconds since local midnight", () => {
    expect(windowSeconds("14:00:00", "23:00:00")).toEqual({ start: 50_400, end: 82_860 });
  });

  test("makes the end exclusive by one minute, since the stored end is inclusive", () => {
    expect(windowSeconds("00:00:00", "00:00:00")).toEqual({ start: 0, end: 60 });
  });

  test("runs a window ending at 23:59 to the end of the day instead of wrapping", () => {
    // Postgres time arithmetic wraps 23:59 + 1 minute to 00:00, which made the
    // window filter match nothing at all. The bound has to be a full day.
    expect(windowSeconds("14:00:00", "23:59:00")).toEqual({ start: 50_400, end: 86_400 });
  });

  test("accepts HH:MM as well as the stored HH:MM:SS", () => {
    expect(windowSeconds("14:00", "23:59")).toEqual({ start: 50_400, end: 86_400 });
  });

  test("falls back to the whole day when a time cannot be parsed", () => {
    expect(windowSeconds("not-a-time", "23:59:00")).toEqual({ start: 0, end: 86_400 });
  });
});

describe("previousLocalDate", () => {
  test("turns an exclusive end bound into the inclusive last day", () => {
    expect(previousLocalDate("2026-10-05")).toBe("2026-10-04");
  });

  test("steps back over a month boundary", () => {
    expect(previousLocalDate("2026-10-01")).toBe("2026-09-30");
  });

  test("steps back over a year boundary", () => {
    expect(previousLocalDate("2026-01-01")).toBe("2025-12-31");
  });

  test("knows February in a leap year", () => {
    expect(previousLocalDate("2028-03-01")).toBe("2028-02-29");
  });

  test("leaves a value it cannot parse alone", () => {
    expect(previousLocalDate("not-a-date")).toBe("not-a-date");
  });
});
