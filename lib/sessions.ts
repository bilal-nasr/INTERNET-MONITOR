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
 * Add one counter sample to a session. The delta is `counter - last_counter`,
 * or the full counter value when it went backwards (an interface reset).
 */
function applySample(t: Tx, id: number, tx: number, rx: number, at: Date): Promise<SessionRow> {
  return t.one<SessionRow>(
    `UPDATE sessions SET
       tx_bytes = tx_bytes + CASE WHEN $2 >= last_tx_counter THEN $2 - last_tx_counter ELSE $2 END,
       rx_bytes = rx_bytes + CASE WHEN $3 >= last_rx_counter THEN $3 - last_rx_counter ELSE $3 END,
       last_tx_counter = $2,
       last_rx_counter = $3,
       last_seen_at = GREATEST(last_seen_at, $4),
       samples = samples + 1
     WHERE id = $1
     RETURNING ${COLS}`,
    [id, tx, rx, at],
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
    const open = await getOpenSession(t);

    // Link is down: close the open session using the last counters the router
    // managed to report before the drop.
    if (!event.running) {
      if (!open) return { action: "ignored", session: null, closed: null };
      const updated = await applySample(t, open.id, event.txCounter, event.rxCounter, event.at);
      const closed = await closeSession(t, updated.id, event.at, "reported");
      return { action: "closed", session: closed, closed };
    }

    let session = open;
    let closed: SessionRow | null = null;
    let action: SessionAction = "sample";

    if (session) {
      const keyChanged = event.sessionKey !== "" && session.session_key !== event.sessionKey;
      const countersReset =
        event.txCounter < session.last_tx_counter || event.rxCounter < session.last_rx_counter;

      if (keyChanged || countersReset) {
        // The link came back between two samples. Close the old session at the
        // new link-up time when we trust it, otherwise at its last sample.
        const start = plausibleStart(event.linkUpAt, event.at);
        const endedAt = start && start > session.started_at ? start : session.last_seen_at;
        closed = await closeSession(t, session.id, endedAt, "restart");
        session = null;
        action = "restarted";
      }
    }

    if (!session) {
      const startedAt = plausibleStart(event.linkUpAt, event.at) ?? event.at;
      const key = event.sessionKey || `${event.interfaceName ?? "wan"}@${startedAt.toISOString()}`;
      session = await t.one<SessionRow>(
        `INSERT INTO sessions (session_key, interface_name, started_at, last_seen_at)
         VALUES ($1, $2, $3, $4)
         RETURNING ${COLS}`,
        [key, event.interfaceName, startedAt, event.at],
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
    downtime_before_seconds: r.downtime_before_seconds,
    tx_bytes: r.tx_bytes,
    rx_bytes: r.rx_bytes,
    total_bytes: r.total_bytes,
    samples: r.samples,
  };
}

/**
 * Sessions that were active in the last `days` days, newest first, with uptime
 * and the offline gap that preceded each one.
 */
export async function getSessions(days: number, limit = 200): Promise<SessionSummary[]> {
  const rows = await db.any<SessionQueryRow>(
    `WITH ordered AS (
       SELECT ${COLS},
              EXTRACT(EPOCH FROM (COALESCE(ended_at, last_seen_at) - started_at))::bigint AS uptime_seconds,
              EXTRACT(EPOCH FROM (
                started_at - LAG(COALESCE(ended_at, last_seen_at)) OVER (ORDER BY started_at, id)
              ))::bigint AS downtime_before_seconds
       FROM sessions
     )
     SELECT * FROM ordered
     WHERE COALESCE(ended_at, last_seen_at) >= now() - ($1::int || ' days')::interval
     ORDER BY started_at DESC, id DESC
     LIMIT $2`,
    [days, limit],
  );
  return rows.map(toSummary);
}

export async function getSessionTotals(days: number): Promise<SessionTotals> {
  const row = await db.one<SessionTotals>(
    `SELECT
       COUNT(*)::int AS sessions,
       COALESCE(SUM(tx_bytes), 0)::bigint AS tx_bytes,
       COALESCE(SUM(rx_bytes), 0)::bigint AS rx_bytes,
       COALESCE(SUM(total_bytes), 0)::bigint AS total_bytes,
       COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, last_seen_at) - started_at))), 0)::bigint
         AS uptime_seconds,
       0::bigint AS downtime_seconds,
       COUNT(*) FILTER (WHERE ended_at IS NOT NULL)::int AS drops
     FROM sessions
     WHERE COALESCE(ended_at, last_seen_at) >= now() - ($1::int || ' days')::interval`,
    [days],
  );
  return row;
}

export function getOpenSessionSummary(): Promise<SessionSummary | null> {
  return db
    .oneOrNone<SessionQueryRow>(
      `SELECT ${COLS},
              EXTRACT(EPOCH FROM (now() - started_at))::bigint AS uptime_seconds,
              NULL::bigint AS downtime_before_seconds
       FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .then((r) => (r ? toSummary(r) : null));
}
