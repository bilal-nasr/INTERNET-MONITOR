import { describe, expect, test } from "vitest";
import { flagAnomalies } from "@/lib/anomaly";

function series(values: number[], start = "2026-09-01"): { day: string; used_bytes: number; readings: number }[] {
  const [y, m, d] = start.split("-").map(Number);
  return values.map((used, i) => ({
    day: new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10),
    used_bytes: used,
    readings: used === 0 ? 0 : 100,
  }));
}

describe("flagAnomalies", () => {
  test("flags a day far above the trailing median", () => {
    const days = series([4e9, 5e9, 4.5e9, 5.2e9, 4.8e9, 5.1e9, 4.9e9, 15e9]);
    const flags = flagAnomalies(days);
    expect(flags).toHaveLength(1);
    expect(flags[0].day).toBe("2026-09-08");
    expect(flags[0].used_bytes).toBe(15e9);
    expect(flags[0].baseline_bytes).toBe(4.9e9);
    expect(flags[0].ratio).toBeCloseTo(15 / 4.9, 3);
    expect(flags[0].z).toBeGreaterThan(2);
  });

  test("needs enough history before it says anything", () => {
    const days = series([4e9, 4e9, 4e9, 40e9]);
    expect(flagAnomalies(days)).toEqual([]);
    expect(flagAnomalies(days, { minDays: 3 })).toHaveLength(1);
  });

  test("a flat series has no anomalies", () => {
    expect(flagAnomalies(series(Array(14).fill(5e9)))).toEqual([]);
  });

  test("a big day that is still under twice the median is not flagged", () => {
    const days = series([5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 9e9]);
    expect(flagAnomalies(days)).toEqual([]);
  });

  test("days with no readings are neither judged nor used as history", () => {
    // Seven real days, then two silent days, then a spike: the silent days
    // must not drag the median down and must not be flagged themselves.
    const days = series([5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 0, 0, 12e9]);
    const flags = flagAnomalies(days);
    expect(flags.map((f) => f.day)).toEqual(["2026-09-10"]);
    expect(flags[0].baseline_bytes).toBe(5e9);
  });

  test("says nothing at all when the trailing days carried no traffic", () => {
    // Rows that count as measured but carry zero bytes -- which is every row on
    // the statistics page, where a day has no reading count to be judged by.
    // With a zero median the ratio is infinite and the MAD is zero, so every
    // later day used to be flagged: an idle fortnight followed by ordinary use
    // produced a flag per day, each reading "∞x the usual 0 B".
    const idle = Array.from({ length: 12 }, (_, i) => ({
      day: `2026-09-${String(i + 1).padStart(2, "0")}`,
      used_bytes: 0,
    }));
    const normal = [4e9, 5e9, 4.5e9, 6e9].map((used, i) => ({
      day: `2026-09-${String(13 + i).padStart(2, "0")}`,
      used_bytes: used,
    }));
    expect(flagAnomalies([...idle, ...normal])).toEqual([]);
  });

  test("judges again once the baseline is above zero", () => {
    // The guard is silence on a zero baseline, not silence forever after one.
    const days = series([0, 0, 5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 20e9]).map((d) => ({
      day: d.day,
      used_bytes: d.used_bytes,
    }));
    expect(flagAnomalies(days).map((f) => f.day)).toEqual(["2026-09-10"]);
  });

  test("uses only the days before the one being judged", () => {
    // The spike must not be part of its own baseline.
    const days = series([5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 20e9, 5e9]);
    const flags = flagAnomalies(days);
    expect(flags.map((f) => f.day)).toEqual(["2026-09-08"]);
  });

  test("accepts the days in any order", () => {
    const days = series([5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 5e9, 20e9]).reverse();
    expect(flagAnomalies(days).map((f) => f.day)).toEqual(["2026-09-08"]);
  });
});
