import { db } from "@/lib/db";

/**
 * One row per alert the application decided to send, whether or not the send
 * worked. The history page reads this; the checks that decide whether to send
 * again read their own state (daily_windows, cycle_alerts) rather than this
 * table, so a failed insert here can never suppress a real alert.
 */

export type AlertKind =
  | "daily_threshold"
  | "daily_exceeded"
  | "cycle_threshold"
  | "cycle_pace"
  | "link_stale"
  | "link_recovered"
  | "digest";

export const ALERT_KINDS: readonly AlertKind[] = [
  "daily_threshold",
  "daily_exceeded",
  "cycle_threshold",
  "cycle_pace",
  "link_stale",
  "link_recovered",
  "digest",
];

export type AlertStatus = "sent" | "failed" | "skipped";

export interface AlertEntry {
  kind: AlertKind;
  level: number | null;
  /** What the alert is about: a local date, a cycle start date, "link", or "digest:<date>". */
  scopeKey: string;
  channel?: "email";
  recipient: string | null;
  subject: string;
  status: AlertStatus;
  error?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface AlertLogRow {
  id: number;
  kind: AlertKind;
  level: number | null;
  scope_key: string;
  channel: string;
  recipient: string | null;
  subject: string;
  status: AlertStatus;
  error: string | null;
  payload: Record<string, unknown> | null;
  created_at: Date;
}

const COLS = "id, kind, level, scope_key, channel, recipient, subject, status, error, payload, created_at";

export function recordAlert(entry: AlertEntry): Promise<AlertLogRow> {
  return db.one<AlertLogRow>(
    `INSERT INTO alerts (kind, level, scope_key, channel, recipient, subject, status, error, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING ${COLS}`,
    [
      entry.kind,
      entry.level,
      entry.scopeKey,
      entry.channel ?? "email",
      entry.recipient,
      entry.subject,
      entry.status,
      entry.error ?? null,
      entry.payload ? JSON.stringify(entry.payload) : null,
    ],
  );
}

/** Newest first. `beforeId` pages backwards: rows with a smaller id than it. */
export function listAlerts(limit: number, beforeId: number | null = null): Promise<AlertLogRow[]> {
  return db.any<AlertLogRow>(
    `SELECT ${COLS} FROM alerts
     WHERE ($2::int IS NULL OR id < $2)
     ORDER BY id DESC
     LIMIT $1`,
    [limit, beforeId],
  );
}

/**
 * One page of the log and the cursor for the next: `limit` rows older than
 * `beforeId`, read one extra so the last page is known without a count.
 */
export async function listAlertsPage(
  limit: number,
  beforeId: number | null = null,
): Promise<{ alerts: AlertLogRow[]; next_cursor: number | null }> {
  const rows = await listAlerts(limit + 1, beforeId);
  const more = rows.length > limit;
  const alerts = more ? rows.slice(0, limit) : rows;
  return { alerts, next_cursor: more ? alerts[alerts.length - 1].id : null };
}

export function countAlerts(): Promise<number> {
  return db.one<{ count: number }>("SELECT COUNT(*)::int AS count FROM alerts").then((r) => r.count);
}

export function latestAlert(kind: AlertKind, scopeKey?: string): Promise<AlertLogRow | null> {
  return db.oneOrNone<AlertLogRow>(
    `SELECT ${COLS} FROM alerts
     WHERE kind = $1 AND ($2::text IS NULL OR scope_key = $2)
     ORDER BY id DESC
     LIMIT 1`,
    [kind, scopeKey ?? null],
  );
}
