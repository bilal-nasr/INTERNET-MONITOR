import { describe, expect, it } from "vitest";
import { clearFailures, recordFailure, retryAfterSeconds } from "./throttle";

describe("login throttle", () => {
  it("allows five failures, then locks until the window ends", () => {
    const key = "t1";
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) recordFailure(key, t0 + i);
    expect(retryAfterSeconds(key, t0 + 10)).toBe(0);
    recordFailure(key, t0 + 5);
    expect(retryAfterSeconds(key, t0 + 10)).toBeGreaterThan(0);
    expect(retryAfterSeconds(key, t0 + 15 * 60 * 1000 + 1)).toBe(0);
  });

  it("forgets on success", () => {
    const key = "t2";
    for (let i = 0; i < 6; i++) recordFailure(key, 5);
    expect(retryAfterSeconds(key, 6)).toBeGreaterThan(0);
    clearFailures(key);
    expect(retryAfterSeconds(key, 6)).toBe(0);
  });
});
