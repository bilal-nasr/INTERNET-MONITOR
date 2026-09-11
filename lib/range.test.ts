import { describe, expect, test } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import {
  InvalidRangeError,
  chooseBucket,
  isRangePreset,
  rangeLabel,
  resolveRange,
} from "@/lib/range";

// A Friday, mid-morning, so "today" and "this week" are both partially elapsed.
const NOW = new Date("2026-09-11T10:30:00Z");
const opts = { timezone: "UTC", cycleDay: 5, now: NOW };

function resolve(input: Record<string, string>) {
  return resolveRange(input, opts);
}

describe("chooseBucket", () => {
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;

  test("uses minute buckets for a one-hour span", () => {
    expect(chooseBucket(HOUR)).toBe("minute");
  });

  test("uses hour buckets for a one-day span", () => {
    expect(chooseBucket(DAY)).toBe("hour");
  });

  test("uses day buckets for a thirty-day span", () => {
    expect(chooseBucket(30 * DAY)).toBe("day");
  });

  test("uses week buckets for a one-year span", () => {
    expect(chooseBucket(365 * DAY)).toBe("week");
  });

  test("uses month buckets for a ten-year span", () => {
    expect(chooseBucket(3650 * DAY)).toBe("month");
  });

  test("uses month buckets when the span is unbounded", () => {
    expect(chooseBucket(null)).toBe("month");
  });
});

describe("isRangePreset", () => {
  test("accepts a known preset", () => {
    expect(isRangePreset("last_hour")).toBe(true);
  });

  test("rejects an unknown name", () => {
    expect(isRangePreset("last_fortnight")).toBe(false);
  });
});

describe("resolveRange relative presets", () => {
  test("last_hour ends now and starts one hour earlier", () => {
    const r = resolve({ range: "last_hour" });
    expect(r.from?.toISOString()).toBe("2026-09-11T09:30:00.000Z");
    expect(r.to.toISOString()).toBe(NOW.toISOString());
    expect(r.bucket).toBe("minute");
  });

  test("last_24h spans the previous twenty-four hours", () => {
    const r = resolve({ range: "last_24h" });
    expect(r.from?.toISOString()).toBe("2026-09-10T10:30:00.000Z");
    expect(r.bucket).toBe("hour");
  });

  test("last_30d spans the previous thirty days in day buckets", () => {
    const r = resolve({ range: "last_30d" });
    expect(r.from?.toISOString()).toBe("2026-08-12T10:30:00.000Z");
    expect(r.bucket).toBe("day");
  });
});

describe("resolveRange calendar presets", () => {
  test("today starts at local midnight and ends now", () => {
    const r = resolve({ range: "today" });
    expect(r.from?.toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(r.to.toISOString()).toBe(NOW.toISOString());
    expect(r.bucket).toBe("hour");
  });

  test("yesterday is a closed day that ends at today's midnight", () => {
    const r = resolve({ range: "yesterday" });
    expect(r.from?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  test("this_week starts on Monday", () => {
    const r = resolve({ range: "this_week" });
    expect(r.from?.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  test("this_year starts on 1 January", () => {
    const r = resolve({ range: "this_year" });
    expect(r.from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(r.bucket).toBe("week");
  });

  test("today respects the settings timezone", () => {
    const r = resolveRange({ range: "today" }, { ...opts, timezone: "Asia/Beirut" });
    expect(r.from?.toISOString()).toBe("2026-09-10T21:00:00.000Z");
  });
});

describe("resolveRange billing cycle presets", () => {
  test("this_cycle starts on the configured cycle day", () => {
    const r = resolve({ range: "this_cycle" });
    expect(r.from?.toISOString()).toBe("2026-09-05T00:00:00.000Z");
    expect(r.to.toISOString()).toBe(NOW.toISOString());
  });

  test("last_cycle is the whole previous cycle", () => {
    const r = resolve({ range: "last_cycle" });
    expect(r.from?.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });
});

describe("resolveRange all_time", () => {
  test("leaves the start open", () => {
    const r = resolve({ range: "all_time" });
    expect(r.from).toBeNull();
    expect(r.bucket).toBe("month");
  });
});

describe("resolveRange custom", () => {
  test("treats bare dates as whole local days, end inclusive", () => {
    const r = resolve({ range: "custom", from: "2026-09-01", to: "2026-09-03" });
    expect(r.from?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-04T00:00:00.000Z");
  });

  test("accepts a local date and time as an exact instant", () => {
    const r = resolve({ range: "custom", from: "2026-09-01T06:15", to: "2026-09-01T18:45" });
    expect(r.from?.toISOString()).toBe("2026-09-01T06:15:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-01T18:45:00.000Z");
  });

  test("rejects a range whose end is not after its start", () => {
    expect(() => resolve({ range: "custom", from: "2026-09-03", to: "2026-09-01" })).toThrow(
      InvalidRangeError,
    );
  });

  test("rejects an unparseable date", () => {
    expect(() => resolve({ range: "custom", from: "not-a-date", to: "2026-09-01" })).toThrow(
      InvalidRangeError,
    );
  });

  test("rejects custom without both endpoints", () => {
    expect(() => resolve({ range: "custom", from: "2026-09-01" })).toThrow(InvalidRangeError);
  });
});

describe("resolveRange input handling", () => {
  test("defaults to today when no range is given", () => {
    expect(resolve({}).preset).toBe("today");
  });

  test("rejects an unknown preset", () => {
    expect(() => resolve({ range: "last_fortnight" })).toThrow(InvalidRangeError);
  });

  test("honours an explicit bucket override", () => {
    expect(resolve({ range: "last_30d", bucket: "hour" }).bucket).toBe("hour");
  });

  test("rejects a bucket that would produce an unusable number of points", () => {
    expect(() => resolve({ range: "last_90d", bucket: "minute" })).toThrow(InvalidRangeError);
  });

  test("rejects an unknown bucket", () => {
    expect(() => resolve({ range: "today", bucket: "fortnight" })).toThrow(InvalidRangeError);
  });

  test("names each preset for display, in the reader's language", () => {
    expect(rangeLabel(en, resolve({ range: "last_hour" }).preset)).toBe("Last hour");
  });
});
