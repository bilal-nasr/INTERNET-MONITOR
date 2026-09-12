/**
 * Whether the cycle is on course to run out of cap before it ends.
 *
 * Early in a cycle the projection is unreliable: a single heavy day, scaled up
 * over a nearly-empty history, reads as runaway growth that never repeats. The
 * warning waits until enough of the cycle has passed to trust the trend.
 */

import type { CycleUsage } from "@/lib/stats";

/** Days of a cycle to ignore before trusting the projection. */
const SETTLE_DAYS = 3;

/**
 * Whether the cycle is on course to run out of cap. Once the cap is actually
 * exceeded the 100% threshold mail covers it, so this stays false then.
 */
export function paceCrossesCap(
  cycle: Pick<CycleUsage, "projected_bytes" | "cap_bytes" | "days_elapsed" | "over">,
): boolean {
  if (cycle.over) return false;
  if (cycle.days_elapsed < SETTLE_DAYS) return false;
  return cycle.projected_bytes > cycle.cap_bytes;
}
