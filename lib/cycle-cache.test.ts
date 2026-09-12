import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CYCLE_CACHE_TTL_MS, getCycleUsageCached, invalidateCycleCache } from "@/lib/cycle-cache";
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
