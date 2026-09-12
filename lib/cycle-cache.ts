import { cycleBounds } from "@/lib/billing";
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
 * The cache key is everything the figure depends on: a changed cap or cycle
 * day drops the value on the next call rather than waiting for the ttl, and so
 * does the start of the cycle, so a rollover can never serve the previous
 * cycle's verdict out of a warm instance.
 *
 * The loader reads the clock itself. It is run again every time the ttl lapses
 * -- on an instance the push keeps warm, that is forever -- so a timestamp
 * captured when the loader was built would freeze the figure: `used` would
 * stop growing and an `over` decided once would never lift.
 */
export const CYCLE_CACHE_TTL_MS = 5 * 60_000;

let key = "";
let cache = memoized<CycleUsage>(() => Promise.reject(new Error("uninitialised")), CYCLE_CACHE_TTL_MS);

export function getCycleUsageCached(settings: SettingsRow, now = new Date()): Promise<CycleUsage> {
  const { monthly_quota_gb, billing_cycle_day, timezone } = settings;
  const { start } = cycleBounds(now, billing_cycle_day, timezone);
  const next = `${monthly_quota_gb}|${billing_cycle_day}|${timezone}|${start.toISOString()}`;
  if (next !== key) {
    key = next;
    cache = memoized(
      () => getCycleUsage(monthly_quota_gb, billing_cycle_day, timezone, new Date()),
      CYCLE_CACHE_TTL_MS,
    );
  }
  return cache.get();
}

export function invalidateCycleCache(): void {
  cache.invalidate();
}
