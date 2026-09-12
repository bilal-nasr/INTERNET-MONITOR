import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CYCLE_CACHE_TTL_MS,
  cycleCacheTtlMs,
  getCycleUsageCached,
  invalidateCycleCache,
  NEAR_CAP_BAND_PERCENT,
  NEAR_CAP_TTL_MS,
} from "@/lib/cycle-cache";
import type { SettingsRow } from "@/lib/settings";
import { getCycleUsage, type CycleUsage } from "@/lib/stats";

/**
 * The one thing the cache touches that needs a database. What is asserted
 * below is the cache's own behaviour: when it runs its loader again, and with
 * which clock reading.
 */
vi.mock("@/lib/stats", () => ({ getCycleUsage: vi.fn() }));

const load = vi.mocked(getCycleUsage);

/** Only the three fields the cache reads; the rest of the row is irrelevant here. */
function settingsRow(over: Partial<SettingsRow> = {}): SettingsRow {
  return { monthly_quota_gb: 100, billing_cycle_day: 1, timezone: "UTC", ...over } as SettingsRow;
}

/** The date the loader was run with on call number `n`, counting from zero. */
function nowOfCall(n: number): number {
  return (load.mock.calls[n][3] as Date).getTime();
}

describe("getCycleUsageCached", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    load.mockReset();
    load.mockImplementation(async () => ({ over: false }) as CycleUsage);
    invalidateCycleCache();
  });
  afterEach(() => vi.useRealTimers());

  test("does not read the database again within the ttl", async () => {
    vi.setSystemTime(new Date("2024-03-10T00:00:00Z"));
    const settings = settingsRow({ monthly_quota_gb: 101 });
    await getCycleUsageCached(settings);
    vi.advanceTimersByTime(CYCLE_CACHE_TTL_MS - 1);
    await getCycleUsageCached(settings);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("runs the loader again with a later date once the ttl has passed", async () => {
    vi.setSystemTime(new Date("2024-03-10T00:00:00Z"));
    const settings = settingsRow({ monthly_quota_gb: 102 });
    await getCycleUsageCached(settings);
    vi.advanceTimersByTime(CYCLE_CACHE_TTL_MS);
    await getCycleUsageCached(settings);

    expect(load).toHaveBeenCalledTimes(2);
    // The point of the fix: the second read asks about the present, not about
    // the moment the cache entry was built.
    expect(nowOfCall(1)).toBeGreaterThan(nowOfCall(0));
    expect(nowOfCall(1)).toBe(nowOfCall(0) + CYCLE_CACHE_TTL_MS);
  });

  test("keeps taking a fresh date on an instance that is never restarted", async () => {
    vi.setSystemTime(new Date("2024-03-10T00:00:00Z"));
    const settings = settingsRow({ monthly_quota_gb: 103 });
    for (let i = 0; i < 4; i++) {
      await getCycleUsageCached(settings);
      vi.advanceTimersByTime(CYCLE_CACHE_TTL_MS);
    }
    expect(load).toHaveBeenCalledTimes(4);
    const seen = load.mock.calls.map((_, i) => nowOfCall(i));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(4);
  });

  test("drops the cached verdict when the cycle rolls over, ttl or no ttl", async () => {
    vi.setSystemTime(new Date("2024-03-31T23:58:00Z"));
    const settings = settingsRow({ monthly_quota_gb: 104 });
    load.mockImplementation(async () => ({ over: true }) as CycleUsage);
    expect((await getCycleUsageCached(settings)).over).toBe(true);

    // Four minutes later: still inside the five-minute ttl, but a new cycle.
    vi.advanceTimersByTime(4 * 60_000);
    load.mockImplementation(async () => ({ over: false }) as CycleUsage);
    expect((await getCycleUsageCached(settings)).over).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("drops the cached figure when the cap or the cycle day changes", async () => {
    vi.setSystemTime(new Date("2024-03-10T00:00:00Z"));
    await getCycleUsageCached(settingsRow({ monthly_quota_gb: 105 }));
    await getCycleUsageCached(settingsRow({ monthly_quota_gb: 106 }));
    await getCycleUsageCached(settingsRow({ monthly_quota_gb: 106, billing_cycle_day: 5 }));
    expect(load).toHaveBeenCalledTimes(3);
  });
});

/**
 * The anti-flap rule. Every instance holds its own snapshot, so the boolean
 * the router is handed can only stop oscillating around the cap if the
 * snapshots near the cap are short enough that every instance re-reads between
 * two pushes. These pin the band and the two ttls it chooses between.
 */
describe("cycleCacheTtlMs", () => {
  const at = (percent: number) => cycleCacheTtlMs({ percent_of_cap: percent } as CycleUsage);

  test("keeps the figure for five minutes while it is nowhere near the cap", () => {
    expect(at(0)).toBe(CYCLE_CACHE_TTL_MS);
    expect(at(42)).toBe(CYCLE_CACHE_TTL_MS);
    expect(at(100 - NEAR_CAP_BAND_PERCENT - 0.01)).toBe(CYCLE_CACHE_TTL_MS);
  });

  test("shortens it inside the band on either side of the cap", () => {
    expect(at(100 - NEAR_CAP_BAND_PERCENT)).toBe(NEAR_CAP_TTL_MS);
    expect(at(99.9)).toBe(NEAR_CAP_TTL_MS);
    expect(at(100)).toBe(NEAR_CAP_TTL_MS);
    expect(at(100.1)).toBe(NEAR_CAP_TTL_MS);
    expect(at(100 + NEAR_CAP_BAND_PERCENT)).toBe(NEAR_CAP_TTL_MS);
  });

  test("goes back to five minutes once the cap is well and truly passed", () => {
    // Above the band every instance agrees, whatever the age of its snapshot.
    expect(at(100 + NEAR_CAP_BAND_PERCENT + 0.01)).toBe(CYCLE_CACHE_TTL_MS);
    expect(at(240)).toBe(CYCLE_CACHE_TTL_MS);
  });

  test("treats a figure with no usable percentage as far from the cap", () => {
    // No cap configured is no boundary to flap around.
    expect(at(Number.NaN)).toBe(CYCLE_CACHE_TTL_MS);
    expect(at(Number.POSITIVE_INFINITY)).toBe(CYCLE_CACHE_TTL_MS);
    expect(cycleCacheTtlMs({} as CycleUsage)).toBe(CYCLE_CACHE_TTL_MS);
  });

  test("the near-cap ttl is shorter than the push interval, or it converges nothing", () => {
    // The router pushes every 30 seconds. A ttl at or above that would let an
    // instance answer two pushes in a row from one reading, which is exactly
    // the disagreement between instances that this is here to end.
    expect(NEAR_CAP_TTL_MS).toBeLessThan(30_000);
  });
});

describe("getCycleUsageCached near the cap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-10T00:00:00Z"));
    load.mockReset();
    invalidateCycleCache();
  });
  afterEach(() => vi.useRealTimers());

  test("re-reads within a push interval while the figure sits on the cap", async () => {
    const settings = settingsRow({ monthly_quota_gb: 201 });
    load.mockImplementation(async () => ({ percent_of_cap: 99.4, over: false }) as CycleUsage);

    await getCycleUsageCached(settings);
    vi.advanceTimersByTime(NEAR_CAP_TTL_MS - 1);
    await getCycleUsageCached(settings);
    expect(load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await getCycleUsageCached(settings);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("an instance holding a near-cap figure catches the crossing on the next push", async () => {
    // The flap this replaces: instance A last read at 99% four minutes ago and
    // keeps answering "under" while instance B, freshly read, answers "over".
    // With the short ttl A cannot still be saying "under" one push later.
    const settings = settingsRow({ monthly_quota_gb: 202 });
    load.mockImplementation(async () => ({ percent_of_cap: 99.8, over: false }) as CycleUsage);
    expect((await getCycleUsageCached(settings)).over).toBe(false);

    load.mockImplementation(async () => ({ percent_of_cap: 100.2, over: true }) as CycleUsage);
    vi.advanceTimersByTime(30_000);
    expect((await getCycleUsageCached(settings)).over).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("does not pay for the short ttl away from the cap", async () => {
    const settings = settingsRow({ monthly_quota_gb: 203 });
    load.mockImplementation(async () => ({ percent_of_cap: 61, over: false }) as CycleUsage);

    await getCycleUsageCached(settings);
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(30_000);
      await getCycleUsageCached(settings);
    }
    // Nine pushes inside the five minutes, and still one aggregate.
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("well over the cap it goes back to the long ttl", async () => {
    const settings = settingsRow({ monthly_quota_gb: 204 });
    load.mockImplementation(async () => ({ percent_of_cap: 130, over: true }) as CycleUsage);

    await getCycleUsageCached(settings);
    vi.advanceTimersByTime(NEAR_CAP_TTL_MS * 3);
    expect((await getCycleUsageCached(settings)).over).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
