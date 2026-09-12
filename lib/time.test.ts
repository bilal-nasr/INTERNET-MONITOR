import { describe, expect, test } from "vitest";
import { localTimeInstant, previousLocalDate, windowSeconds, zonedTimeToUtc } from "@/lib/time";

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

describe("zonedTimeToUtc", () => {
  const BEIRUT = "Asia/Beirut";

  function localOf(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(date)
      .replace(",", "");
  }

  test("resolves an ordinary local time to the instant that reads it back", () => {
    const instant = zonedTimeToUtc(2026, 9, 10, 22, 0, 0, BEIRUT);
    expect(instant.toISOString()).toBe("2026-09-10T19:00:00.000Z"); // UTC+3 in summer
    expect(localOf(instant, BEIRUT)).toBe("2026-09-10 22:00");
  });

  test("takes the first instant after the gap for a time the clock skips", () => {
    // Asia/Beirut springs forward at 00:00 on the last Sunday of March, so
    // 2027-03-28 00:00 never happens: the clock goes straight to 01:00. The
    // answer has to be that 01:00 and not 23:00 the evening before, or the day
    // boundary moves backwards and everything measured per day with it.
    const instant = zonedTimeToUtc(2027, 3, 28, 0, 0, 0, BEIRUT);
    expect(instant.toISOString()).toBe("2027-03-27T22:00:00.000Z");
    expect(localOf(instant, BEIRUT)).toBe("2027-03-28 01:00");
  });

  test("shifts a skipped time forward by the gap rather than backwards", () => {
    const instant = zonedTimeToUtc(2027, 3, 28, 0, 30, 0, BEIRUT);
    expect(localOf(instant, BEIRUT)).toBe("2027-03-28 01:30");
  });

  test("gives a real instant for a local time that happens twice", () => {
    // The clock goes back at 00:00 on the last Sunday of October, so 23:30 the
    // evening before happens twice. Either occurrence is a correct answer; what
    // matters is that the instant reads back as the time that was asked for.
    const instant = zonedTimeToUtc(2026, 10, 24, 23, 30, 0, BEIRUT);
    expect(localOf(instant, BEIRUT)).toBe("2026-10-24 23:30");
  });

  test("handles a zone that changes at 02:00 as well", () => {
    expect(zonedTimeToUtc(2027, 3, 14, 2, 30, 0, "America/New_York").toISOString()).toBe(
      "2027-03-14T07:30:00.000Z", // 03:30 EDT, the first instant after the gap
    );
    expect(zonedTimeToUtc(2027, 11, 7, 1, 30, 0, "America/New_York").toISOString()).toBe(
      "2027-11-07T05:30:00.000Z", // 01:30 EDT, the first of the two occurrences
    );
  });

  test("a zone without DST is unaffected", () => {
    expect(zonedTimeToUtc(2027, 3, 28, 0, 0, 0, "UTC").toISOString()).toBe(
      "2027-03-28T00:00:00.000Z",
    );
  });
});

describe("localTimeInstant", () => {
  test("the midnight after a day is the first instant of the next day", () => {
    // The bound the per-day split is built on. Before the fix this landed an
    // hour *before* the cursor it was meant to bound on Beirut's spring-forward
    // night, which silently dropped most of an outage.
    const midnight = localTimeInstant("2027-03-27", "00:00", "Asia/Beirut", 1440);
    expect(midnight?.toISOString()).toBe("2027-03-27T22:00:00.000Z");
    expect(midnight!.getTime()).toBeGreaterThan(
      new Date("2027-03-27T20:00:00.000Z").getTime(), // 22:00 local, inside that evening
    );
  });

  test("an ordinary day is a full 24 hours apart", () => {
    const start = localTimeInstant("2026-09-10", "00:00", "Asia/Beirut");
    const end = localTimeInstant("2026-09-10", "00:00", "Asia/Beirut", 1440);
    expect((end!.getTime() - start!.getTime()) / 3_600_000).toBe(24);
  });

  test("returns null for a date or a time it cannot parse", () => {
    expect(localTimeInstant("not-a-date", "00:00", "UTC")).toBeNull();
    expect(localTimeInstant("2026-09-10", "not-a-time", "UTC")).toBeNull();
  });
});
