import type { ITask } from "pg-promise";
import { db } from "@/lib/db";

/**
 * A WAN link session (one PPPoE connection, or one period of link-up).
 *
 * `tx_bytes` / `rx_bytes` are *accumulated* traffic for the session, not the
 * raw interface counters: the raw values live in `last_tx_counter` /
 * `last_rx_counter` and are used to derive each sample's delta. A PPPoE
 * interface restarts its counters at zero on every reconnect, so accumulating
 * deltas keeps the session total right even if the counters reset mid-session.
 */
export interface SessionRow {
  id: number;
  session_key: string;
  interface_name: string | null;
  started_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
  last_seen_at: Date;
  tx_bytes: number;
  rx_bytes: number;
  total_bytes: number;
  last_tx_counter: number;
  last_rx_counter: number;
  samples: number;
}

export type SessionAction = "started" | "restarted" | "sample" | "closed" | "ignored";

export interface SessionEvent {
  /** Router's own identifier for the session, usually `last-link-up-time`. May be empty. */
  sessionKey: string;
  interfaceName: string | null;
  /** Parsed `last-link-up-time`, when the router reported a usable one. */
  linkUpAt: Date | null;
  running: boolean;
  txCounter: number;
  rxCounter: number;
  /** Server time for this sample. */
  at: Date;
}

export interface SessionOutcome {
  action: SessionAction;
  session: SessionRow | null;
  /** Set when this event also closed a previous session. */
  closed: SessionRow | null;
}

type Tx = ITask<object>;

/** Arbitrary fixed key; only this module takes it. */
const SESSION_LOCK_KEY = 8_474_120_001;

const COLS = `id, session_key, interface_name, started_at, ended_at, end_reason,
              last_seen_at, tx_bytes, rx_bytes, total_bytes,
              last_tx_counter, last_rx_counter, samples`;

/** A link-up time is only trusted when it is in the past and reasonably recent. */
function plausibleStart(linkUpAt: Date | null, at: Date): Date | null {
  if (!linkUpAt) return null;
  const ms = linkUpAt.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms > at.getTime() + 60_000) return null; // in the future: router clock is wrong
  if (ms < at.getTime() - 365 * 24 * 3600_000) return null; // over a year ago
  return linkUpAt;
}

/**
 * When the router cannot say when the link came up, fall back to the earliest
 * reading of the current counter run. The counters have only grown since that
 * reading, so the link has been up at least that long. Bounded to a week so a
 * first deployment onto a long history cannot claim months of uptime.
 */
function inferStartFromReadings(t: Tx, before: Date): Promise<Date | null> {
  return t
    .oneOrNone<{ started: Date | null }>(
      `WITH r AS (
         SELECT recorded_at, total_bytes,
                LAG(total_bytes) OVER (ORDER BY recorded_at, id) AS prev
         FROM interface_readings
         WHERE recorded_at <= $1::timestamptz
           AND recorded_at >= $1::timestamptz - INTERVAL '7 days'
       ),
       last_reset AS (
         SELECT MAX(recorded_at) AS at FROM r WHERE prev IS NOT NULL AND total_bytes < prev
       )
       SELECT MIN(r.recorded_at) AS started
       FROM r, last_reset
       WHERE last_reset.at IS NULL OR r.recorded_at >= last_reset.at`,
      [before],
    )
    .then((row) => row?.started ?? null);
}

/** Latest moment any session was known to be alive, used to keep the timeline monotonic. */
function getLastActivity(t: Tx): Promise<Date | null> {
  return t
    .one<{ last_activity: Date | null }>(
      "SELECT MAX(COALESCE(ended_at, last_seen_at)) AS last_activity FROM sessions",
    )
    .then((r) => r.last_activity);
}

/** The newest session row, which is the predecessor once the open one is closed. */
function getPreviousSession(t: Tx): Promise<SessionRow | null> {
  return t.oneOrNone<SessionRow>(
    `SELECT ${COLS} FROM sessions ORDER BY started_at DESC, id DESC LIMIT 1`,
  );
}

function getOpenSession(t: Tx): Promise<SessionRow | null> {
  return t.oneOrNone<SessionRow>(
    `SELECT ${COLS} FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1`,
  );
}

function closeSession(t: Tx, id: number, endedAt: Date, reason: string): Promise<SessionRow> {
  return t.one<SessionRow>(
    `UPDATE sessions
     SET ended_at = GREATEST($2, started_at), end_reason = $3
     WHERE id = $1
     RETURNING ${COLS}`,
    [id, endedAt, reason],
  );
}

/**
 * Add one counter sample to a session: the growth since the last sample.
 *
 * A counter that goes backwards inside an open session adds nothing and cannot
 * pull `last_*_counter` down. A genuine interface reset is handled one level up
 * by starting a new session, so the only way to see a lower counter here is a
 * stale sample arriving out of order, and crediting its full value would invent
 * gigabytes of traffic.
 *
 * `advanceLastSeen` is false for the final sample of a session, which arrives
 * with the link already down: those counters are the last ones the router
 * managed to read, but the link was not up at that moment, so `last_seen_at`
 * must keep pointing at the last sample that found it running.
 */
function applySample(
  t: Tx,
  id: number,
  tx: number,
  rx: number,
  at: Date,
  advanceLastSeen = true,
): Promise<SessionRow> {
  return t.one<SessionRow>(
    `UPDATE sessions SET
       tx_bytes = tx_bytes + GREATEST($2 - last_tx_counter, 0),
       rx_bytes = rx_bytes + GREATEST($3 - last_rx_counter, 0),
       last_tx_counter = GREATEST(last_tx_counter, $2),
       last_rx_counter = GREATEST(last_rx_counter, $3),
       last_seen_at = CASE WHEN $5 THEN GREATEST(last_seen_at, $4) ELSE last_seen_at END,
       samples = samples + 1
     WHERE id = $1
     RETURNING ${COLS}`,
    [id, tx, rx, at, advanceLastSeen],
  );
}

/**
 * Record one session event from the router and return what it changed.
 *
 * Identity rule: there is at most one open session (`ended_at IS NULL`). A
 * sample belongs to it unless the router reports a different session key, or
 * the interface counters went backwards, either of which means the link
 * reconnected between two samples.
 */
export function applySessionEvent(event: SessionEvent): Promise<SessionOutcome> {
  return db.tx(async (t): Promise<SessionOutcome> => {
    // Only one ingest may move the session state at a time. Two overlapping
    // pushes would otherwise both see "no open session" and each create one, or
    // both close the same session and credit the same traffic to two successors.
    // Transaction-scoped, so it is released on commit and is safe behind a
    // transaction-mode connection pooler.
    await t.one("SELECT pg_advisory_xact_lock($1)", [SESSION_LOCK_KEY]);

    const open = await getOpenSession(t);

    // Link is down: close the open session using the last counters the router
    // managed to report before the drop.
    if (!event.running) {
      if (!open) return { action: "ignored", session: null, closed: null };
      const updated = await applySample(t, open.id, event.txCounter, event.rxCounter, event.at, false);
      // The link went down somewhere between the last sample that found it up
      // and this one. Ending at the last confirmed sighting keeps the outage
      // visible instead of swallowing it; it can overstate downtime by up to
      // one push interval.
      const closed = await closeSession(t, updated.id, updated.last_seen_at, "reported");
      return { action: "closed", session: closed, closed };
    }

    let session = open;
    let closed: SessionRow | null = null;
    let action: SessionAction = "sample";

    if (session) {
      // A sample that is not newer than the last one is a retry or an overtaken
      // request. Its counters describe the past, so they must never be read as
      // evidence that the link reconnected.
      const fresh = event.at.getTime() > session.last_seen_at.getTime();
      const keyChanged =
        fresh && event.sessionKey !== "" && session.session_key !== event.sessionKey;
      const countersReset =
        fresh &&
        (event.txCounter < session.last_tx_counter || event.rxCounter < session.last_rx_counter);
      // The router reporting a link-up later than this session began means the
      // link went down and came back. This is the only signal left when the
      // router sends no session id and the counters did not reset. The minute
      // of slack absorbs clock jitter and a start time that was clamped.
      const relinked =
        fresh &&
        event.linkUpAt !== null &&
        event.linkUpAt.getTime() > session.started_at.getTime() + 60_000 &&
        event.linkUpAt.getTime() <= event.at.getTime() + 60_000;

      if (keyChanged || countersReset || relinked) {
        // The link came back between two samples, so the old session ended at
        // the last sample that found it up. The new session then starts at the
        // router's link-up time, which is what makes the outage measurable.
        closed = await closeSession(t, session.id, session.last_seen_at, "restart");
        session = null;
        action = "restarted";
      }
    }

    if (!session) {
      // Clamp the start between the end of the previous session and now, so a
      // router clock that drifts can never produce overlapping sessions or a
      // negative offline gap.
      const lastActivity = await getLastActivity(t);
      const candidate =
        plausibleStart(event.linkUpAt, event.at) ??
        (await inferStartFromReadings(t, event.at)) ??
        event.at;
      let startedAt = candidate > event.at ? event.at : candidate;
      if (lastActivity && startedAt < lastActivity) startedAt = lastActivity;

      // Decide where the new session's traffic should be measured from. A real
      // reconnect restarts the interface counters at zero, so the session is
      // credited everything it reports. But a PPPoE client that is disabled and
      // re-enabled keeps counting, and RouterOS also keeps the counters across
      // some reconnects, so when the incoming counters carry on from where the
      // previous session stopped, the new one must start from there instead of
      // being credited the whole lifetime total.
      const candidatePrevious = closed ?? (await getPreviousSession(t));
      // Counters only carry over within one interface. If the WAN interface
      // changed, the new counter stream is unrelated and must start from zero.
      const previous =
        candidatePrevious && candidatePrevious.interface_name === event.interfaceName
          ? candidatePrevious
          : null;
      // Decided per direction: the router reads tx and rx in two separate
      // statements, so a reconnect between them can reset one and not the other.
      const seedTx =
        previous && event.txCounter >= previous.last_tx_counter ? previous.last_tx_counter : 0;
      const seedRx =
        previous && event.rxCounter >= previous.last_rx_counter ? previous.last_rx_counter : 0;

      const key = event.sessionKey || `${event.interfaceName ?? "wan"}@${startedAt.toISOString()}`;
      session = await t.one<SessionRow>(
        `INSERT INTO sessions (session_key, interface_name, started_at, last_seen_at,
                               last_tx_counter, last_rx_counter)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${COLS}`,
        [key, event.interfaceName, startedAt, event.at, seedTx, seedRx],
      );
      if (action !== "restarted") action = "started";
    }

    const updated = await applySample(t, session.id, event.txCounter, event.rxCounter, event.at);
    return { action, session: updated, closed };
  });
}

export interface SessionSummary {
  id: number;
  session_key: string;
  interface_name: string | null;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  last_seen_at: string;
  open: boolean;
  uptime_seconds: number;
  /** How long ago the router last reported on this session. */
  seconds_since_seen: number;
  /** Time the link was down between the previous session and this one. */
  downtime_before_seconds: number | null;
  tx_bytes: number;
  rx_bytes: number;
  total_bytes: number;
  samples: number;
}

export interface SessionTotals {
  sessions: number;
  tx_bytes: number;
  rx_bytes: number;
  total_bytes: number;
  uptime_seconds: number;
  downtime_seconds: number;
  drops: number;
}

interface SessionQueryRow extends SessionRow {
  uptime_seconds: number;
  downtime_before_seconds: number | null;
  seconds_since_seen: number;
}

function toSummary(r: SessionQueryRow): SessionSummary {
  return {
    id: r.id,
    session_key: r.session_key,
    interface_name: r.interface_name,
    started_at: r.started_at.toISOString(),
    ended_at: r.ended_at ? r.ended_at.toISOString() : null,
    end_reason: r.end_reason,
    last_seen_at: r.last_seen_at.toISOString(),
    open: r.ended_at === null,
    uptime_seconds: r.uptime_seconds,
    seconds_since_seen: r.seconds_since_seen,
    downtime_before_seconds: r.downtime_before_seconds,
    tx_bytes: r.tx_bytes,
    rx_bytes: r.rx_bytes,
    total_bytes: r.total_bytes,
    samples: r.samples,
  };
}

/** A half-open window of wall-clock time; a null start means "everything ever". */
export interface SessionWindow {
  from: Date | null;
  to: Date;
}

/**
 * Sessions overlapping the window, newest first, with uptime and the offline
 * gap that preceded each one. A session counts when any part of it falls inside
 * the window, so an outage in progress at either edge is still visible.
 */
export async function getSessions(
  { from, to }: SessionWindow,
  limit = 200,
): Promise<SessionSummary[]> {
  const rows = await db.any<SessionQueryRow>(
    `WITH ordered AS (
       SELECT ${COLS},
              GREATEST(EXTRACT(EPOCH FROM (now() - last_seen_at)), 0)::bigint AS seconds_since_seen,
              GREATEST(EXTRACT(EPOCH FROM (COALESCE(ended_at, last_seen_at) - started_at)), 0)::bigint AS uptime_seconds,
              GREATEST(EXTRACT(EPOCH FROM (
                started_at - LAG(COALESCE(ended_at, last_seen_at)) OVER (ORDER BY started_at, id)
              )), 0)::bigint AS downtime_before_seconds
       FROM sessions
     )
     SELECT * FROM ordered
     WHERE COALESCE(ended_at, last_seen_at) >= COALESCE($1::timestamptz, '-infinity'::timestamptz)
       AND started_at < $2::timestamptz
     ORDER BY started_at DESC, id DESC
     LIMIT $3`,
    [from, to, limit],
  );
  return rows.map(toSummary);
}

export async function getSessionTotals({ from, to }: SessionWindow): Promise<SessionTotals> {
  // The LAG window runs over every session so the first session inside the
  // range still knows how long the link was down before it.
  return db.one<SessionTotals>(
    `WITH ordered AS (
       SELECT started_at, ended_at, tx_bytes, rx_bytes, total_bytes,
              COALESCE(ended_at, last_seen_at) AS finished_at,
              LAG(COALESCE(ended_at, last_seen_at)) OVER (ORDER BY started_at, id) AS prev_finished
       FROM sessions
     )
     SELECT
       COUNT(*)::int AS sessions,
       COALESCE(SUM(tx_bytes), 0)::bigint AS tx_bytes,
       COALESCE(SUM(rx_bytes), 0)::bigint AS rx_bytes,
       COALESCE(SUM(total_bytes), 0)::bigint AS total_bytes,
       COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (finished_at - started_at)), 0)), 0)::bigint AS uptime_seconds,
       -- Clipped to the window, so a gap that began before the range cannot
       -- report more downtime than the range contains. The first session ever
       -- has no predecessor and therefore no gap: without the CASE, GREATEST
       -- would silently drop the NULL and measure back to the window start.
       COALESCE(SUM(
         CASE WHEN prev_finished IS NULL THEN 0
              ELSE GREATEST(EXTRACT(EPOCH FROM (
                started_at - GREATEST(prev_finished, COALESCE($1::timestamptz, prev_finished))
              )), 0)
         END
       ), 0)::bigint AS downtime_seconds,
       COUNT(*) FILTER (WHERE ended_at IS NOT NULL)::int AS drops
     FROM ordered
     WHERE finished_at >= COALESCE($1::timestamptz, '-infinity'::timestamptz)
       AND started_at < $2::timestamptz`,
    [from, to],
  );
}

/**
 * The newest session whether it is open or closed, so the dashboard can say
 * "the link went down at 14:32" rather than falling silent.
 */
export function getLatestSessionSummary(): Promise<SessionSummary | null> {
  return db
    .oneOrNone<SessionQueryRow>(
      `SELECT ${COLS},
              GREATEST(EXTRACT(EPOCH FROM (COALESCE(ended_at, last_seen_at) - started_at)), 0)::bigint AS uptime_seconds,
              GREATEST(EXTRACT(EPOCH FROM (now() - last_seen_at)), 0)::bigint AS seconds_since_seen,
              NULL::bigint AS downtime_before_seconds
       FROM sessions ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .then((r) => (r ? toSummary(r) : null));
}

export function getOpenSessionSummary(): Promise<SessionSummary | null> {
  return db
    .oneOrNone<SessionQueryRow>(
      `SELECT ${COLS},
              GREATEST(EXTRACT(EPOCH FROM (now() - started_at)), 0)::bigint AS uptime_seconds,
              GREATEST(EXTRACT(EPOCH FROM (now() - last_seen_at)), 0)::bigint AS seconds_since_seen,
              NULL::bigint AS downtime_before_seconds
       FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .then((r) => (r ? toSummary(r) : null));
}
