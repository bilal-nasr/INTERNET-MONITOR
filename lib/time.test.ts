import { describe, expect, test } from "vitest";
import { windowSeconds } from "@/lib/time";

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
