import { describe, expect, test } from "vitest";
import { paceCrossesCap } from "@/lib/alerts/pace";

const base = { projected_bytes: 650e9, cap_bytes: 600e9, days_elapsed: 10, over: false };

describe("paceCrossesCap", () => {
  test("fires when the projection exceeds the cap after the third day", () => {
    expect(paceCrossesCap(base)).toBe(true);
  });

  test("stays quiet for the first three days, when one heavy day skews the projection", () => {
    expect(paceCrossesCap({ ...base, days_elapsed: 2 })).toBe(false);
    expect(paceCrossesCap({ ...base, days_elapsed: 3 })).toBe(true);
  });

  test("stays quiet when the projection is within the cap", () => {
    expect(paceCrossesCap({ ...base, projected_bytes: 600e9 })).toBe(false);
  });

  test("leaves an already-exceeded cap to the threshold alert", () => {
    expect(paceCrossesCap({ ...base, over: true })).toBe(false);
  });
});
