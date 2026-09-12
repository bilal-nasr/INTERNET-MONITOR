/**
 * Which alert mark, if any, a usage figure has just reached.
 *
 * Marks are percentages of a quota. A day (or a cycle) remembers the highest
 * mark already mailed; the next mail goes out only for a higher mark. When one
 * push jumps past several marks at once, only the highest is reported, so a
 * burst of traffic produces one mail rather than a backlog.
 */

export const MAX_THRESHOLDS = 8;

export function nextThreshold(
  percent: number,
  notifiedLevel: number,
  thresholds: number[],
): number | null {
  let best: number | null = null;
  for (const mark of thresholds) {
    if (mark > notifiedLevel && percent >= mark && (best === null || mark > best)) {
      best = mark;
    }
  }
  return best;
}

/** Integers 1..100, strictly ascending, at most MAX_THRESHOLDS of them. */
export function isThresholdList(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length > MAX_THRESHOLDS) return false;
  let previous = 0;
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item)) return false;
    if (item < 1 || item > 100 || item <= previous) return false;
    previous = item;
  }
  return true;
}
