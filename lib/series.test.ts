import { describe, expect, test } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import type { HeatCell, SeriesPoint } from "@/lib/stats";
import {
  fillSeries,
  foldIntoCycles,
  formatBucketLabel,
  formatBucketTitle,
  hourProfile,
  peakCell,
  weekdayProfile,
} from "@/lib/series";

function point(bucket: string, total: number): SeriesPoint {
  return { bucket, total_bytes: total, tx_bytes: 0, rx_bytes: total, readings: 1 };
}

describe("fillSeries", () => {
  test("inserts zero buckets for hours with no readings", () => {
    const filled = fillSeries(
      [point("2026-09-11T08:00:00", 500)],
      new Date("2026-09-11T07:00:00Z"),
      new Date("2026-09-11T10:00:00Z"),
      "hour",
      "UTC",
    );
    expect(filled.map((p) => p.bucket)).toEqual([
      "2026-09-11T07:00:00",
      "2026-09-11T08:00:00",
      "2026-09-11T09:00:00",
    ]);
    expect(filled.map((p) => p.total_bytes)).toEqual([0, 500, 0]);
  });

  test("keeps every value the database returned", () => {
    const filled = fillSeries(
      [point("2026-09-11T07:00:00", 100), point("2026-09-11T09:00:00", 300)],
      new Date("2026-09-11T07:00:00Z"),
      new Date("2026-09-11T10:00:00Z"),
      "hour",
      "UTC",
    );
    expect(filled.map((p) => p.total_bytes)).toEqual([100, 0, 300]);
  });

  test("buckets days from local midnight", () => {
    const filled = fillSeries(
      [point("2026-09-10T00:00:00", 42)],
      new Date("2026-09-09T13:00:00Z"),
      new Date("2026-09-11T13:00:00Z"),
      "day",
      "UTC",
    );
    expect(filled.map((p) => p.bucket)).toEqual([
      "2026-09-09T00:00:00",
      "2026-09-10T00:00:00",
      "2026-09-11T00:00:00",
    ]);
  });

  test("starts week buckets on Monday", () => {
    const filled = fillSeries(
      [],
      new Date("2026-09-11T00:00:00Z"), // a Friday
      new Date("2026-09-15T00:00:00Z"), // the following Tuesday
      "week",
      "UTC",
    );
    expect(filled.map((p) => p.bucket)).toEqual(["2026-09-07T00:00:00", "2026-09-14T00:00:00"]);
  });

  test("starts month buckets on the first of the month", () => {
    const filled = fillSeries(
      [],
      new Date("2026-08-20T00:00:00Z"),
      new Date("2026-10-05T00:00:00Z"),
      "month",
      "UTC",
    );
    expect(filled.map((p) => p.bucket)).toEqual([
      "2026-08-01T00:00:00",
      "2026-09-01T00:00:00",
      "2026-10-01T00:00:00",
    ]);
  });

  test("labels buckets in the settings timezone", () => {
    const filled = fillSeries(
      [],
      new Date("2026-09-10T22:00:00Z"), // 01:00 on the 11th in Beirut
      new Date("2026-09-10T23:00:00Z"),
      "hour",
      "Asia/Beirut",
    );
    expect(filled.map((p) => p.bucket)).toEqual(["2026-09-11T01:00:00"]);
  });

  test("returns the points untouched when the range has no start", () => {
    const points = [point("2026-01-01T00:00:00", 7)];
    expect(fillSeries(points, null, new Date("2026-09-11T00:00:00Z"), "month", "UTC")).toEqual(points);
  });
});

describe("foldIntoCycles", () => {
  const days = [
    point("2026-08-04T00:00:00", 10), // before the 5 August cycle
    point("2026-08-06T00:00:00", 20),
    point("2026-09-04T00:00:00", 30), // last day of the August cycle
    point("2026-09-05T00:00:00", 40), // first day of the September cycle
    point("2026-09-11T00:00:00", 50),
  ];

  test("assigns each day to the cycle that contains it", () => {
    const cycles = foldIntoCycles(days, 5, "UTC", 2, new Date("2026-09-11T10:00:00Z"));
    expect(cycles).toHaveLength(2);
    expect(cycles[0].total_bytes).toBe(50); // 20 + 30
    expect(cycles[1].total_bytes).toBe(90); // 40 + 50
  });

  test("returns cycles oldest first with their local start dates", () => {
    const cycles = foldIntoCycles(days, 5, "UTC", 2, new Date("2026-09-11T10:00:00Z"));
    expect(cycles[0].start_date).toBe("2026-08-05");
    expect(cycles[1].start_date).toBe("2026-09-05");
  });

  test("marks only the cycle containing now as current", () => {
    const cycles = foldIntoCycles(days, 5, "UTC", 2, new Date("2026-09-11T10:00:00Z"));
    expect(cycles.map((c) => c.current)).toEqual([false, true]);
  });

  test("reports a cycle with no data as zero rather than omitting it", () => {
    const cycles = foldIntoCycles([], 5, "UTC", 3, new Date("2026-09-11T10:00:00Z"));
    expect(cycles.map((c) => c.total_bytes)).toEqual([0, 0, 0]);
  });
});

describe("heatmap folds", () => {
  const cells: HeatCell[] = [
    { weekday: 1, hour: 9, total_bytes: 100, readings: 2 },
    { weekday: 1, hour: 21, total_bytes: 700, readings: 5 },
    { weekday: 5, hour: 9, total_bytes: 250, readings: 3 },
  ];

  test("hourProfile returns all twenty-four hours in order", () => {
    const hours = hourProfile(cells);
    expect(hours).toHaveLength(24);
    expect(hours[9].total_bytes).toBe(350);
    expect(hours[21].total_bytes).toBe(700);
    expect(hours[0].total_bytes).toBe(0);
  });

  test("weekdayProfile returns Monday through Sunday", () => {
    const weekdays = weekdayProfile(cells, en);
    expect(weekdays).toHaveLength(7);
    expect(weekdays[0].label).toBe("Mon");
    expect(weekdays[0].total_bytes).toBe(800);
    expect(weekdays[4].total_bytes).toBe(250);
    expect(weekdays[6].total_bytes).toBe(0);
  });

  test("peakCell finds the busiest weekday and hour", () => {
    expect(peakCell(cells)).toEqual({ weekday: 1, hour: 21, total_bytes: 700, readings: 5 });
  });

  test("peakCell returns null when there is nothing to rank", () => {
    expect(peakCell([])).toBeNull();
  });
});

describe("bucket labels", () => {
  test("shows the time of day for minute and hour buckets", () => {
    expect(formatBucketLabel("2026-09-11T14:05:00", "minute", en)).toBe("14:05");
    expect(formatBucketLabel("2026-09-11T14:00:00", "hour", en)).toBe("14:00");
  });

  test("shows the calendar day for day and week buckets", () => {
    expect(formatBucketLabel("2026-09-11T00:00:00", "day", en)).toBe("11 Sep");
    expect(formatBucketLabel("2026-09-07T00:00:00", "week", en)).toBe("7 Sep");
  });

  test("shows month and year for month buckets", () => {
    expect(formatBucketLabel("2026-09-01T00:00:00", "month", en)).toBe("Sep 2026");
  });

  test("titles a minute bucket with its full date and time", () => {
    expect(formatBucketTitle("2026-09-11T14:05:00", "minute", en)).toBe("11 Sep 2026, 14:05");
  });

  test("titles a day bucket with the date alone", () => {
    expect(formatBucketTitle("2026-09-11T00:00:00", "day", en)).toBe("11 Sep 2026");
  });

  test("titles a week bucket as the week it starts", () => {
    expect(formatBucketTitle("2026-09-07T00:00:00", "week", en)).toBe("Week of 7 Sep 2026");
  });
});
