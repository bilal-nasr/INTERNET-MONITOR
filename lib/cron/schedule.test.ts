import { describe, expect, test } from "vitest";
import { digestDueAt, digestReportDate, isDigestDue, isStale } from "@/lib/cron/schedule";

const TZ = "Asia/Beirut"; // UTC+3 in September 2026

/** A Beirut wall-clock time as an instant. September is UTC+3. */
function beirut(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+03:00`);
}

describe("isStale", () => {
  const now = beirut("2026-09-14", "12:00");

  test("is false when readings are recent", () => {
    expect(isStale(beirut("2026-09-14", "11:55"), now, 10)).toBe(false);
  });

  test("is true once the silence exceeds the limit", () => {
    expect(isStale(beirut("2026-09-14", "11:49"), now, 10)).toBe(true);
  });

  test("is false exactly at the limit", () => {
    // Ten minutes of silence is "up to ten minutes", not "more than".
    expect(isStale(beirut("2026-09-14", "11:50"), now, 10)).toBe(false);
  });

  test("is never stale when the limit is 0", () => {
    expect(isStale(beirut("2026-09-01", "00:00"), now, 0)).toBe(false);
  });

  test("is not stale with no reading at all", () => {
    // Nothing to compare against; a fresh install is not an outage.
    expect(isStale(null, now, 10)).toBe(false);
  });
});

describe("digestDueAt", () => {
  test("off has no due instant", () => {
    expect(digestDueAt("off", beirut("2026-09-14", "09:00"), 5, TZ)).toBeNull();
  });

  test("weekly: Monday after 08:00 is due that Monday at 08:00", () => {
    // 2026-09-14 is a Monday.
    expect(digestDueAt("weekly", beirut("2026-09-14", "09:00"), 5, TZ)).toEqual(
      beirut("2026-09-14", "08:00"),
    );
  });

  test("weekly: Monday at 07:59 still belongs to the previous Monday", () => {
    expect(digestDueAt("weekly", beirut("2026-09-14", "07:59"), 5, TZ)).toEqual(
      beirut("2026-09-07", "08:00"),
    );
  });

  test("weekly: exactly 08:00 counts", () => {
    expect(digestDueAt("weekly", beirut("2026-09-14", "08:00"), 5, TZ)).toEqual(
      beirut("2026-09-14", "08:00"),
    );
  });

  test("weekly: a Thursday points back to the Monday before", () => {
    expect(digestDueAt("weekly", beirut("2026-09-17", "15:00"), 5, TZ)).toEqual(
      beirut("2026-09-14", "08:00"),
    );
  });

  test("weekly: Monday 01:00 local (Sunday 22:00 UTC) still resolves to the local Monday", () => {
    // Beirut is UTC+3, so this instant's UTC calendar date is Sunday 2026-09-13
    // while its local calendar date is Monday 2026-09-14. The day-of-week used
    // to find "this Monday" must come from the local date, not the UTC one.
    expect(digestDueAt("weekly", beirut("2026-09-14", "01:00"), 5, TZ)).toEqual(
      beirut("2026-09-07", "08:00"),
    );
  });

  test("cycle: the 5th at 09:00 is due on the 5th at 08:00", () => {
    expect(digestDueAt("cycle", beirut("2026-09-05", "09:00"), 5, TZ)).toEqual(
      beirut("2026-09-05", "08:00"),
    );
  });

  test("cycle: the 5th at 07:59 is still the previous cycle's morning", () => {
    expect(digestDueAt("cycle", beirut("2026-09-05", "07:59"), 5, TZ)).toEqual(
      beirut("2026-08-05", "08:00"),
    );
  });

  test("cycle: mid-cycle points at the current cycle's first morning", () => {
    expect(digestDueAt("cycle", beirut("2026-09-20", "12:00"), 5, TZ)).toEqual(
      beirut("2026-09-05", "08:00"),
    );
  });

  test("cycle: a cycle day past the end of a short month clamps", () => {
    // February 2026 has 28 days; a cycle day of 31 starts on the 28th.
    expect(digestDueAt("cycle", new Date("2026-03-10T12:00:00+02:00"), 31, TZ)).toEqual(
      new Date("2026-02-28T08:00:00+02:00"),
    );
  });

  test("cycle: rollover day at 01:00 local (previous day 22:00 UTC) still resolves to the local rollover day", () => {
    // Beirut is UTC+3, so this instant's UTC calendar date is 2026-09-04 while
    // its local calendar date is 2026-09-05, the cycle day. Which cycle "now"
    // belongs to must be decided from the local date, not the UTC one.
    expect(digestDueAt("cycle", beirut("2026-09-05", "01:00"), 5, TZ)).toEqual(
      beirut("2026-08-05", "08:00"),
    );
  });
});

describe("isDigestDue", () => {
  const monday9 = beirut("2026-09-14", "09:00");

  test("never sent: due at the first tick", () => {
    expect(isDigestDue("weekly", monday9, null, 5, TZ)).toBe(true);
  });

  test("sent before this Monday 08:00: due", () => {
    expect(isDigestDue("weekly", monday9, beirut("2026-09-07", "08:03"), 5, TZ)).toBe(true);
  });

  test("sent after this Monday 08:00: not due again", () => {
    expect(isDigestDue("weekly", monday9, beirut("2026-09-14", "08:02"), 5, TZ)).toBe(false);
  });

  test("off: never due, even if never sent", () => {
    expect(isDigestDue("off", monday9, null, 5, TZ)).toBe(false);
  });

  test("cycle: sent last cycle, now past this cycle's morning: due", () => {
    expect(isDigestDue("cycle", beirut("2026-09-05", "08:10"), beirut("2026-08-05", "08:05"), 5, TZ)).toBe(true);
  });

  test("cycle: sent this cycle: not due", () => {
    expect(isDigestDue("cycle", beirut("2026-09-20", "12:00"), beirut("2026-09-05", "08:05"), 5, TZ)).toBe(false);
  });
});

describe("digestReportDate", () => {
  test("weekly reports on the day before the due instant, measured up to local midnight", () => {
    const { date, asOf } = digestReportDate("weekly", beirut("2026-09-14", "08:00"), 5, TZ);
    expect(date).toBe("2026-09-13");
    expect(asOf).toEqual(beirut("2026-09-14", "00:00"));
  });

  test("cycle reports on the last day of the previous cycle, measured up to the cycle end", () => {
    const { date, asOf } = digestReportDate("cycle", beirut("2026-09-05", "08:00"), 5, TZ);
    expect(date).toBe("2026-09-04");
    expect(asOf).toEqual(beirut("2026-09-05", "00:00"));
  });

  test("off yields the day before, so a caller never gets an invalid date", () => {
    const { date } = digestReportDate("off", beirut("2026-09-14", "08:00"), 5, TZ);
    expect(date).toBe("2026-09-13");
  });
});
