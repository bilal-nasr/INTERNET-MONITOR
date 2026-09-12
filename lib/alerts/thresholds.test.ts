import { describe, expect, test } from "vitest";
import { isThresholdList, nextThreshold } from "@/lib/alerts/thresholds";

const MARKS = [50, 80, 100];

describe("nextThreshold", () => {
  test("says nothing below the first mark", () => {
    expect(nextThreshold(49.9, 0, MARKS)).toBeNull();
  });

  test("fires exactly on a mark", () => {
    expect(nextThreshold(50, 0, MARKS)).toBe(50);
  });

  test("folds skipped marks into the highest one reached", () => {
    // 40 % to 95 % in one push: one 80 % mail, not a 50 % and an 80 %.
    expect(nextThreshold(95, 0, MARKS)).toBe(80);
  });

  test("does not repeat a mark already notified", () => {
    expect(nextThreshold(85, 80, MARKS)).toBeNull();
  });

  test("moves on to the next mark after the last one notified", () => {
    expect(nextThreshold(101, 80, MARKS)).toBe(100);
  });

  test("keeps firing above 100 only for marks not yet sent", () => {
    expect(nextThreshold(250, 100, MARKS)).toBeNull();
  });

  test("returns null for an empty list", () => {
    expect(nextThreshold(200, 0, [])).toBeNull();
  });

  test("tolerates an unsorted list by picking the highest reached", () => {
    expect(nextThreshold(85, 0, [100, 50, 80])).toBe(80);
  });
});

describe("isThresholdList", () => {
  test("accepts the default", () => {
    expect(isThresholdList([50, 80, 100])).toBe(true);
  });

  test("accepts an empty list (alerts off)", () => {
    expect(isThresholdList([])).toBe(true);
  });

  test("rejects an unsorted list", () => {
    expect(isThresholdList([80, 50])).toBe(false);
  });

  test("rejects duplicates", () => {
    expect(isThresholdList([50, 50, 100])).toBe(false);
  });

  test("rejects more than eight marks", () => {
    expect(isThresholdList([10, 20, 30, 40, 50, 60, 70, 80, 90])).toBe(false);
  });

  test("rejects non-integers, zero, and values over 100", () => {
    expect(isThresholdList([50.5])).toBe(false);
    expect(isThresholdList([0, 50])).toBe(false);
    expect(isThresholdList([50, 101])).toBe(false);
  });

  test("rejects things that are not arrays of numbers", () => {
    expect(isThresholdList("50,80")).toBe(false);
    expect(isThresholdList([50, "80"])).toBe(false);
    expect(isThresholdList(null)).toBe(false);
  });
});
