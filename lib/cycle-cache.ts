import { cycleBounds } from "@/lib/billing";
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

/**
 * How long the figure is kept while it sits near the cap, and how near "near"
 * is, as a percentage of the cap either side of 100.
 *
 * Why this exists. Every concurrent instance holds its own snapshot, and the
 * answer they hand the router is a boolean about a value that grows past a
 * fixed line. Around the moment the line is crossed, an instance that last
 * read four minutes ago still says "under" while an instance that read ten
 * seconds ago says "over"; successive 30-second pushes land on different
 * instances, so the router turns its queue and its firewall rule on, off, on,
 * off for as long as the stalest snapshot lives -- churning connection
 * tracking and filling the router log, once per push, for up to five minutes.
 *
 * The fix is convergence rather than hysteresis. Hysteresis would be the wrong
 * tool here: the oscillation is not one instance dithering about a noisy
 * measurement, it is several instances disagreeing about a monotonic one, and
 * a band held per instance leaves each of them just as free to disagree with
 * the next -- while also, in the one direction that matters, holding "under"
 * after the cap was genuinely passed. What removes the disagreement is making
 * the snapshots agree: inside the band the figure is kept for less than one
 * push interval, so every instance re-reads on every push and they all answer
 * from the same number. Outside the band every instance is on the same side of
 * the line anyway and the five-minute figure costs nothing.
 *
 * The extra reads are bounded and they are bought where they are worth it: one
 * aggregate per push, only while usage sits within a few percent of the cap,
 * which is a narrow slice of a month. Below the band nothing is throttled;
 * above it everything is, and neither verdict can flip back inside a cycle.
 */
export const NEAR_CAP_TTL_MS = 20_000;
export const NEAR_CAP_BAND_PERCENT = 5;

/**
 * How long this figure may be reused, from how close it is to the cap.
 *
 * A figure with no usable percentage (a cap of zero, or a loader that did not
 * produce one) is treated as far from the line: there is no boundary to flap
 * around when there is no cap.
 */
export function cycleCacheTtlMs(usage: Pick<CycleUsage, "percent_of_cap">): number {
  const percent = usage.percent_of_cap;
  if (!Number.isFinite(percent)) return CYCLE_CACHE_TTL_MS;
  return Math.abs(percent - 100) <= NEAR_CAP_BAND_PERCENT ? NEAR_CAP_TTL_MS : CYCLE_CACHE_TTL_MS;
}

let key = "";
let cell: { at: number; data: CycleUsage } | null = null;
let inflight: Promise<CycleUsage> | null = null;

export function getCycleUsageCached(settings: SettingsRow, now = new Date()): Promise<CycleUsage> {
  const { monthly_quota_gb, billing_cycle_day, timezone } = settings;
  const { start } = cycleBounds(now, billing_cycle_day, timezone);
  const next = `${monthly_quota_gb}|${billing_cycle_day}|${timezone}|${start.toISOString()}`;
  if (next !== key) {
    key = next;
    cell = null;
    // A load still running was started for the cycle or the cap that just
    // changed; its answer is no longer about what is being asked.
    inflight = null;
  }

  if (cell && Date.now() - cell.at < cycleCacheTtlMs(cell.data)) return Promise.resolve(cell.data);

  if (!inflight) {
    // The key this load belongs to. A load that finishes after the key moved on
    // must not fill the cache, nor clear the newer load's handle.
    const loadedFor = key;
    inflight = getCycleUsage(monthly_quota_gb, billing_cycle_day, timezone, new Date()).then(
      (data) => {
        if (key === loadedFor) {
          cell = { at: Date.now(), data };
          inflight = null;
        }
        return data;
      },
      (err) => {
        if (key === loadedFor) inflight = null;
        throw err;
      },
    );
  }
  return inflight;
}

export function invalidateCycleCache(): void {
  cell = null;
}
