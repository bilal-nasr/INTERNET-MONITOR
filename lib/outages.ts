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
): Outage[] {
  const ordered = [...sessions].sort((a, b) => {
    const byStart = a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0;
    return byStart !== 0 ? byStart : a.id - b.id;
  });
  if (ordered.length === 0) return [];

  const out: Outage[] = [];

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

/** Guard against a pathological range: nothing on these pages spans years. */
const MAX_DAYS_PER_OUTAGE = 400;

export function downtimeByDay(outages: Outage[], timezone: string): DayDowntime[] {
  const byDay = new Map<string, DayDowntime>();

  for (const outage of outages) {
    let cursor = new Date(outage.from).getTime();
    const end = new Date(outage.to).getTime();
    let guard = 0;

    while (cursor < end && guard++ < MAX_DAYS_PER_OUTAGE) {
      const day = localParts(new Date(cursor), timezone).date;
      // Local midnight after `day`; localTimeInstant shifts the calendar day
      // by the minute offset, so 1440 lands on the next day's 00:00.
      const nextMidnight = localTimeInstant(day, "00:00", timezone, 1440);
      const sliceEnd = Math.min(end, nextMidnight ? nextMidnight.getTime() : end);
      const seconds = Math.round((sliceEnd - cursor) / 1000);

      const row = byDay.get(day) ?? { day, seconds: 0, outages: 0 };
      row.seconds += seconds;
      row.outages += 1;
      byDay.set(day, row);

      if (sliceEnd <= cursor) break;
      cursor = sliceEnd;
    }
  }

  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
