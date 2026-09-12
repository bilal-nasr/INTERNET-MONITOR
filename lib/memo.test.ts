import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoized } from "@/lib/memo";

describe("memoized", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("returns what the loader produced", async () => {
    const m = memoized(async () => 42, 1000);
    expect(await m.get()).toBe(42);
  });

  test("does not call the loader again within the ttl", async () => {
    let calls = 0;
    const m = memoized(async () => ++calls, 1000);
    await m.get();
    vi.advanceTimersByTime(999);
    expect(await m.get()).toBe(1);
    expect(calls).toBe(1);
  });

  test("calls the loader again once the ttl has passed", async () => {
    let calls = 0;
    const m = memoized(async () => ++calls, 1000);
    await m.get();
    vi.advanceTimersByTime(1000);
    expect(await m.get()).toBe(2);
  });

  test("invalidate forces the next get to reload", async () => {
    let calls = 0;
    const m = memoized(async () => ++calls, 1000);
    await m.get();
    m.invalidate();
    expect(await m.get()).toBe(2);
  });

  test("shares one in-flight load between concurrent callers", async () => {
    let calls = 0;
    const m = memoized(async () => ++calls, 1000);
    const [a, b] = await Promise.all([m.get(), m.get()]);
    expect([a, b]).toEqual([1, 1]);
    expect(calls).toBe(1);
  });

  test("does not cache a failed load", async () => {
    let calls = 0;
    const m = memoized(async () => {
      calls++;
      if (calls === 1) throw new Error("down");
      return calls;
    }, 1000);
    await expect(m.get()).rejects.toThrow("down");
    expect(await m.get()).toBe(2);
  });
});
