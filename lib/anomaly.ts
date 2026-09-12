/**
 * Days whose traffic is out of line with the days before them.
 *
 * Judged against the median and the median absolute deviation of the earlier
 * days, because a home link's daily totals are skewed: one download day
 * would drag a mean and a standard deviation up and hide the next one. Two
 * tests must both pass, so a spike on a noisy series is not flagged merely
 * for being noisy, and a noticeable-but-ordinary day is not flagged merely
 * for standing out of a very flat week.
 */

export interface AnomalyDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  used_bytes: number;
  /** Readings that landed on the day. Absent means measured. */
  readings?: number;
}

export interface AnomalyFlag {
  day: string;
  used_bytes: number;
  /** The median of the earlier measured days. Always above zero. */
  baseline_bytes: number;
  /** used_bytes / baseline_bytes. */
  ratio: number;
  /** Robust z-score (0.6745 * deviation / MAD); Infinity when MAD is zero and the day is above the median. */
  z: number;
}

export interface AnomalyOptions {
  /** Measured days that must precede a day before it is judged. */
  minDays: number;
  /** Day must be at least this many times the baseline. */
  minRatio: number;
  /** Day must be at least this many robust standard deviations above the baseline. */
  minZ: number;
}

export const DEFAULT_ANOMALY_OPTIONS: AnomalyOptions = { minDays: 7, minRatio: 2, minZ: 2 };

/** Consistency constant that scales MAD to a normal standard deviation. */
const MAD_TO_SIGMA = 0.6745;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function measured(day: AnomalyDay): boolean {
  return day.readings === undefined || day.readings > 0;
}

export function flagAnomalies(days: AnomalyDay[], opts: Partial<AnomalyOptions> = {}): AnomalyFlag[] {
  const o = { ...DEFAULT_ANOMALY_OPTIONS, ...opts };
  const ordered = [...days].filter(measured).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const flags: AnomalyFlag[] = [];

  for (let i = 0; i < ordered.length; i++) {
    if (i < o.minDays) continue;
    const history = ordered.slice(0, i).map((d) => d.used_bytes);
    const baseline = median(history);
    // Nothing to be out of line with. A zero median means most of the trailing
    // days carried no traffic at all, and "x times nothing" is not a fact about
    // today: with the ratio infinite and the MAD zero, every later day with any
    // traffic would be flagged, so an idle fortnight turns the list into a wall
    // of rows reading "∞× the usual 0 B". The feature falls silent instead.
    // This is the only guard on the statistics page, whose rows carry no
    // `readings` count for `measured` to judge them by.
    if (baseline <= 0) continue;
    const mad = median(history.map((v) => Math.abs(v - baseline)));
    const used = ordered[i].used_bytes;
    const deviation = used - baseline;

    const ratio = used / baseline;
    const z =
      mad > 0
        ? (MAD_TO_SIGMA * deviation) / mad
        : deviation > 0
          ? Number.POSITIVE_INFINITY
          : 0;

    if (ratio >= o.minRatio && z >= o.minZ) {
      flags.push({ day: ordered[i].day, used_bytes: used, baseline_bytes: baseline, ratio, z });
    }
  }
  return flags;
}
