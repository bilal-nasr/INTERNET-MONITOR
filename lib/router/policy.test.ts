import { describe, expect, test } from "vitest";
import { decidePolicy, type PolicyInput } from "@/lib/router/policy";

const off: PolicyInput = {
  throttleOnBreach: false,
  throttleOnCap: false,
  windowActive: false,
  dailyExceeded: false,
  capExceeded: false,
};

describe("decidePolicy", () => {
  test("never throttles when both switches are off, whatever the usage", () => {
    expect(decidePolicy({ ...off, windowActive: true, dailyExceeded: true, capExceeded: true })).toEqual({
      throttle: false,
      reason: null,
    });
  });

  test("throttles for the daily quota only while the window is active", () => {
    const on = { ...off, throttleOnBreach: true, dailyExceeded: true };
    expect(decidePolicy({ ...on, windowActive: true })).toEqual({ throttle: true, reason: "daily_quota" });
    // The quota governs traffic inside the window; outside it there is nothing to enforce.
    expect(decidePolicy({ ...on, windowActive: false })).toEqual({ throttle: false, reason: null });
  });

  test("does not throttle for the daily quota when it is not exceeded", () => {
    expect(decidePolicy({ ...off, throttleOnBreach: true, windowActive: true })).toEqual({
      throttle: false,
      reason: null,
    });
  });

  test("throttles for the monthly cap at any hour", () => {
    const on = { ...off, throttleOnCap: true, capExceeded: true };
    expect(decidePolicy({ ...on, windowActive: false })).toEqual({ throttle: true, reason: "monthly_cap" });
    expect(decidePolicy({ ...on, windowActive: true })).toEqual({ throttle: true, reason: "monthly_cap" });
  });

  test("ignores an exceeded cap when its switch is off", () => {
    expect(decidePolicy({ ...off, throttleOnBreach: true, capExceeded: true })).toEqual({
      throttle: false,
      reason: null,
    });
  });

  test("names the daily quota when both apply", () => {
    // The daily breach is the more immediate cause and the one the alert email cites.
    expect(
      decidePolicy({
        throttleOnBreach: true,
        throttleOnCap: true,
        windowActive: true,
        dailyExceeded: true,
        capExceeded: true,
      }),
    ).toEqual({ throttle: true, reason: "daily_quota" });
  });
});
