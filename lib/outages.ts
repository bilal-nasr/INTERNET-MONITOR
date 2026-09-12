import { fill } from "@/lib/i18n";
import { appendSegment, CAUSE_SIDES, causeSide, type CauseSegment, type CauseSide } from "@/lib/outage-cause";
import type { SessionSummary } from "@/lib/sessions";
import { localParts, localTimeInstant } from "@/lib/time";

/**
 * Periods the link was down, derived from the sessions table.
 *
 * A session ends when the router reports the link down (or when a reconnect
 * is detected), and the next one starts at the router's link-up time, so the
 * space between them is the outage. `getSessions` lists only sessions that
 * overlap the range, which leaves two edges to handle: the gap before the
 * first listed session is known only through its `downtime_before_seconds`,
 * and a closed newest session means the link has not come back yet.
 */

export interface Outage {
  /** ISO instant the link went down (clipped to the range). */
  from: string;
  /** ISO instant the link came back, or the end of the range while it is still down. */
  to: string;
  seconds: number;
  /** The session that ended; null when it lies before the listed sessions. */
  ended_session_id: number | null;
  /** The session that followed; null while the link is still down. */
  next_session_id: number | null;
}

export interface DayDowntime {
  /** Local date, YYYY-MM-DD. */
  day: string;
  seconds: number;
  /** Outages touching the day; one outage spanning midnight counts on both days. */
  outages: number;
}

function clip(
  fromMs: number,
  toMs: number,
  range: { from: Date | null; to: Date },
): { from: number; to: number } | null {
  const lo = range.from ? Math.max(fromMs, range.from.getTime()) : fromMs;
  const hi = Math.min(toMs, range.to.getTime());
  return hi > lo ? { from: lo, to: hi } : null;
}

function toOutage(
  span: { from: number; to: number },
  endedSessionId: number | null,
  nextSessionId: number | null,
): Outage {
  return {
    from: new Date(span.from).toISOString(),
    to: new Date(span.to).toISOString(),
    seconds: Math.round((span.to - span.from) / 1000),
    ended_session_id: endedSessionId,
    next_session_id: nextSessionId,
  };
}

export function outagesFromSessions(
  sessions: SessionSummary[],
  range: { from: Date | null; to: Date },
  /**
   * The newest session of all, used only when none overlaps the range. A link
   * that has been down since before the range starts has no session inside it,
   * so without this the report reads "no outages" during the one event it
   * exists to describe.
   */
  previous: SessionSummary | null = null,
): Outage[] {
  const ordered = [...sessions].sort((a, b) => {
    const byStart = a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0;
    return byStart !== 0 ? byStart : a.id - b.id;
  });

  const out: Outage[] = [];

  if (ordered.length === 0) {
    // Only a closed session tells us the link was down: an open one that is
    // merely out of contact is a different state, reported as "no contact".
    if (previous?.ended_at && range.from) {
      const endedAt = new Date(previous.ended_at).getTime();
      if (endedAt <= range.from.getTime()) {
        const span = clip(endedAt, range.to.getTime(), range);
        if (span) out.push(toOutage(span, previous.id, null));
      }
    }
    return out;
  }

  // The gap before the first listed session: its predecessor is not in the list.
  const first = ordered[0];
  if (first.downtime_before_seconds && first.downtime_before_seconds > 0) {
    const startMs = new Date(first.started_at).getTime();
    const span = clip(startMs - first.downtime_before_seconds * 1000, startMs, range);
    if (span) out.push(toOutage(span, null, first.id));
  }

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (!prev.ended_at) continue; // an open session has no successor gap
    const span = clip(new Date(prev.ended_at).getTime(), new Date(cur.started_at).getTime(), range);
    if (span) out.push(toOutage(span, prev.id, cur.id));
  }

  // A closed newest session: the link is still down at the end of the range.
  const last = ordered[ordered.length - 1];
  if (last.ended_at) {
    const span = clip(new Date(last.ended_at).getTime(), range.to.getTime(), range);
    if (span) out.push(toOutage(span, last.id, null));
  }

  return out;
}

/**
 * The end of the window downtime is measured over: the end of the range, or
 * now, whichever comes first.
 *
 * A custom range ending on a bare date runs to the *next* local midnight, so
 * that its last day is included in full (lib/range.ts). For a range ending
 * today that instant is hours away, and the trailing-outage rule would clip a
 * link that dropped at 14:50 to it and report nine hours of downtime that have
 * not happened yet. Nothing is known about the future, so the report stops here.
 */
export function downtimeWindowEnd(to: Date, now = new Date()): Date {
  return to.getTime() <= now.getTime() ? to : now;
}

/** Guard against a pathological range: nothing on these pages spans years. */
const MAX_SLICES_PER_OUTAGE = 400;

const HOUR_MS = 3_600_000;

export function downtimeByDay(outages: Outage[], timezone: string): DayDowntime[] {
  const byDay = new Map<string, DayDowntime>();

  for (const outage of outages) {
    let cursor = new Date(outage.from).getTime();
    const end = new Date(outage.to).getTime();
    // One outage counts once per day however many slices it takes to cross it.
    const counted = new Set<string>();
    let guard = 0;

    while (cursor < end && guard++ < MAX_SLICES_PER_OUTAGE) {
      const day = localParts(new Date(cursor), timezone).date;
      // Local midnight after `day`; localTimeInstant shifts the calendar day
      // by the minute offset, so 1440 lands on the next day's 00:00.
      const nextMidnight = localTimeInstant(day, "00:00", timezone, 1440);
      const boundary = nextMidnight ? nextMidnight.getTime() : end;
      // A boundary that is not after the cursor cannot end this slice. That is
      // a timezone the helper could not place; stepping an hour and re-deriving
      // the day walks out of it, where stopping here would silently drop the
      // rest of the outage.
      const sliceEnd = Math.min(end, boundary > cursor ? boundary : cursor + HOUR_MS);
      const seconds = Math.round((sliceEnd - cursor) / 1000);

      const row = byDay.get(day) ?? { day, seconds: 0, outages: 0 };
      row.seconds += seconds;
      if (!counted.has(day)) {
        row.outages += 1;
        counted.add(day);
      }
      byDay.set(day, row);

      cursor = sliceEnd;
    }
  }

  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** A silence as stored in outage_causes, trimmed to what the pages show. */
export interface StoredSilence {
  silence_from: string;
  silence_to: string;
  segments: CauseSegment[];
}

export interface OutageWithCauses extends Outage {
  /** Ordered, touching and covering the outage exactly; "unknown" where the router said nothing. */
  causes: CauseSegment[];
}

/**
 * Give each outage the causes the router reported for the time it covers.
 *
 * The outage itself is left as it is: its span and its seconds come from the
 * sessions, which is what the downtime totals are measured from, so labelling
 * an outage never changes how long it was.
 */
export function attachCauses(outages: Outage[], silences: StoredSilence[]): OutageWithCauses[] {
  const segments = silences
    .flatMap((silence) => silence.segments)
    .sort((a, b) => Date.parse(a.from) - Date.parse(b.from));

  return outages.map((outage) => {
    const lo = Date.parse(outage.from);
    const hi = Date.parse(outage.to);
    const causes: CauseSegment[] = [];
    let cursor = lo;
    for (const segment of segments) {
      const start = Math.max(Date.parse(segment.from), cursor);
      const end = Math.min(Date.parse(segment.to), hi);
      if (end <= start) continue;
      appendSegment(causes, cursor, start, "unknown");
      appendSegment(causes, start, end, segment.cause);
      cursor = end;
    }
    appendSegment(causes, cursor, hi, "unknown");
    return { ...outage, causes };
  });
}

/**
 * Silences that are not downtime: the router went quiet but no session outage
 * lies behind it (a short blip where PPPoE never dropped), or the only thing
 * wrong was reaching the app.
 */
export function monitoringGaps(silences: StoredSilence[], outages: Outage[]): StoredSilence[] {
  return silences.filter((silence) => {
    const lo = Date.parse(silence.silence_from);
    const hi = Date.parse(silence.silence_to);
    const overlaps = outages.some((o) => Date.parse(o.from) < hi && lo < Date.parse(o.to));
    return !overlaps || silence.segments.every((segment) => segment.cause === "app_unreachable");
  });
}

export type DowntimeSplit = Record<CauseSide, number>;

function emptySplit(): DowntimeSplit {
  return { yours: 0, isp: 0, neutral: 0, unknown: 0 };
}

/**
 * Seconds of downtime by side, over the outages listed. Bounded by the same row
 * limit as the list, so on a very long range it can fall short of the total
 * counted in the database; it is shown as a hint beside that total, not as one.
 */
export function downtimeSplit(outages: OutageWithCauses[]): DowntimeSplit {
  const split = emptySplit();
  for (const outage of outages) {
    for (const segment of outage.causes) {
      split[causeSide(segment.cause)] += Math.round((Date.parse(segment.to) - Date.parse(segment.from)) / 1000);
    }
  }
  return split;
}

/** The same split for each local day, sliced at midnight the way downtimeByDay slices outages. */
export function downtimeSplitByDay(outages: OutageWithCauses[], timezone: string): Map<string, DowntimeSplit> {
  const byDay = new Map<string, DowntimeSplit>();
  for (const side of CAUSE_SIDES) {
    const spans: Outage[] = outages.flatMap((outage) =>
      outage.causes
        .filter((segment) => causeSide(segment.cause) === side)
        .map((segment) => ({
          from: segment.from,
          to: segment.to,
          seconds: 0,
          ended_session_id: null,
          next_session_id: null,
        })),
    );
    for (const row of downtimeByDay(spans, timezone)) {
      const split = byDay.get(row.day) ?? emptySplit();
      split[side] += row.seconds;
      byDay.set(row.day, split);
    }
  }
  return byDay;
}

export interface SplitWords {
  splitYours: string;
  splitIsp: string;
  splitNeutral: string;
  splitUnknown: string;
}

/**
 * The split as short phrases, each side with time, in a fixed order. Nothing
 * when no second has a known cause: a range from before the router sent
 * evidence would otherwise say "cause unknown" beside every figure.
 */
export function describeSplit(
  split: DowntimeSplit,
  words: SplitWords,
  duration: (seconds: number) => string,
): string[] {
  if (split.yours + split.isp + split.neutral === 0) return [];
  const parts: [number, string][] = [
    [split.yours, words.splitYours],
    [split.isp, words.splitIsp],
    [split.neutral, words.splitNeutral],
    [split.unknown, words.splitUnknown],
  ];
  return parts.filter(([seconds]) => seconds > 0).map(([seconds, text]) => fill(text, { duration: duration(seconds) }));
}
