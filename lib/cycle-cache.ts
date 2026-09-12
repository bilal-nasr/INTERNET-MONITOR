import { memoized } from "@/lib/memo";
import type { SettingsRow } from "@/lib/settings";
import { getCycleUsage, type CycleUsage } from "@/lib/stats";

/**
 * The cycle total is one aggregate over the whole cycle, tens of thousands of
 * rows on a month of 30-second pushes. The push arrives every 30 seconds and
 * only needs to know whether the cap is exceeded, a fact that changes at most
 * once per cycle, so the figure is kept for five minutes. A cap crossed in
 * those five minutes is enforced on the next refresh, which is well inside the
 * accuracy anyone expects of a monthly cap.
 *
 * The cache key is the settings the figure depends on: a changed cap or cycle
 * day drops the value on the next call rather than waiting for the ttl.
 */
export const CYCLE_CACHE_TTL_MS = 5 * 60_000;

let key = "";
let cache = memoized<CycleUsage>(() => Promise.reject(new Error("uninitialised")), CYCLE_CACHE_TTL_MS);

export function getCycleUsageCached(settings: SettingsRow, now = new Date()): Promise<CycleUsage> {
  const next = `${settings.monthly_quota_gb}|${settings.billing_cycle_day}|${settings.timezone}`;
  if (next !== key) {
    key = next;
    cache = memoized(
      () => getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone, now),
      CYCLE_CACHE_TTL_MS,
    );
  }
  return cache.get();
}

export function invalidateCycleCache(): void {
  cache.invalidate();
}
