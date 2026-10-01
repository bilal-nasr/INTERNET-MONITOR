/**
 * The steps of a data reset, in the order they run (see lib/data-reset.ts).
 * Kept apart from that module because the settings card needs the list too,
 * and lib/data-reset.ts imports node:crypto, which has no place in a browser.
 *
 * The session trim comes first because it reads the readings that the later
 * steps delete.
 */
export const RESET_STEPS = [
  "sessions_trimmed",
  "sessions",
  "readings",
  "device_readings",
  "devices",
  "daily_windows",
  "alerts",
  "cycle_alerts",
  "outage_causes",
] as const;

export type ResetStep = (typeof RESET_STEPS)[number];

export type ResetCounts = Record<ResetStep, number>;

/** Rows actually removed. The trimmed session keeps its row, so it is not one of them. */
export function removedRows(counts: ResetCounts): number {
  return RESET_STEPS.filter((s) => s !== "sessions_trimmed").reduce((sum, s) => sum + counts[s], 0);
}
