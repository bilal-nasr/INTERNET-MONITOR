/**
 * Deleting everything recorded before the end of a finished billing cycle:
 * which cut-offs are allowed, the emailed code that confirms one, and the exact
 * SQL that does it.
 *
 * The cut is always a single instant with nothing kept before it, never a
 * cycle taken out of the middle. A hole in the history would read on every page
 * as the longest outage the router ever had.
 *
 * Pure, like lib/retention.ts: no database, no clock of its own, so the rules
 * and the statements can be read and tested without either. The plumbing that
 * runs them is lib/data-reset-store.ts.
 */

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { cycleBounds, type CycleBounds } from "@/lib/billing";
import { RESET_STEPS, type ResetStep } from "@/lib/data-reset-steps";
import { localParts } from "@/lib/time";

export { RESET_STEPS, removedRows, type ResetCounts, type ResetStep } from "@/lib/data-reset-steps";

/** How long an emailed code stays usable. */
export const CODE_TTL_SECONDS = 10 * 60;

/** Wrong guesses one code survives. A million codes, five tries: one in 200,000. */
export const MAX_CODE_ATTEMPTS = 5;

/** How far back the list of cycles reaches. Two years is more than retention keeps. */
export const MAX_LISTED_CYCLES = 24;

// ---------------------------------------------------------- cut-offs ----

/**
 * Finished cycles that still hold data, newest first. A cycle qualifies when
 * the first data was recorded before its end; the running cycle never does.
 */
export function finishedCycles(
  now: Date,
  firstDataAt: Date | null,
  cycleDay: number,
  timezone: string,
): CycleBounds[] {
  if (!firstDataAt) return [];
  const cycles: CycleBounds[] = [];
  for (let offset = -1; offset >= -MAX_LISTED_CYCLES; offset--) {
    const cycle = cycleBounds(now, cycleDay, timezone, offset);
    if (cycle.end.getTime() <= firstDataAt.getTime()) break;
    cycles.push(cycle);
  }
  return cycles;
}

/**
 * True when `cutoff` is the end of a finished cycle: a cycle boundary at or
 * before the start of the running one. Checked on the server for every
 * request, so a hand-made request cannot cut into the running cycle.
 */
export function isDeletableCutoff(cutoff: Date, now: Date, cycleDay: number, timezone: string): boolean {
  if (Number.isNaN(cutoff.getTime())) return false;
  if (cutoff.getTime() > cycleBounds(now, cycleDay, timezone).start.getTime()) return false;
  return cycleBounds(cutoff, cycleDay, timezone).start.getTime() === cutoff.getTime();
}

/** A cut-off as a request carries it (an ISO instant), or null when it is not a deletable one. */
export function parseCutoff(value: unknown, now: Date, cycleDay: number, timezone: string): Date | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const cutoff = new Date(value);
  return isDeletableCutoff(cutoff, now, cycleDay, timezone) ? cutoff : null;
}

/** The local date of the cut-off, which the date-keyed tables are compared with. */
export function cutoffLocalDate(cutoff: Date, timezone: string): string {
  return localParts(cutoff, timezone).date;
}

// ------------------------------------------------------------- codes ----

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Reject anything that is not shaped like a code we issued, before it reaches a query. */
export function looksLikeCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

/**
 * The stored form of a code. The cut-off is part of the input, so a code sent
 * to confirm one date cannot be spent on another. Six digits are easy to
 * enumerate offline; what protects a code is the attempt limit and the ten
 * minutes, the hash only keeps it out of a casual read of the table.
 */
export function hashCode(code: string, cutoff: Date): string {
  return createHash("sha256").update(`${cutoff.toISOString()}|${code}`).digest("hex");
}

export function codesMatch(storedHash: string, candidateHash: string): boolean {
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(candidateHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "b•••@example.com": enough for the owner to recognise the inbox, no more. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return email;
  return `${email[0]}•••${email.slice(at)}`;
}

// --------------------------------------------------------------- SQL ----

// Every statement takes $1 = the cut-off instant and $2 = its local date, for
// the tables keyed by date. The steps and their order are in
// lib/data-reset-steps.ts.

/** Like lib/retention.ts: `count` is the read-only twin of `delete`, same rows, same predicate. */
export type ResetMode = "delete" | "count";

/** The plain deletes: a table and the predicate that picks the rows before the cut-off. */
const DELETES: Record<Exclude<ResetStep, "sessions_trimmed">, { table: string; where: string }> = {
  // Closed sessions only. An open session is the baseline the next push is
  // measured against: without it the next push opens a session with no
  // predecessor and credits it the router's whole lifetime counter.
  sessions: { table: "sessions", where: "ended_at IS NOT NULL AND ended_at < $1::timestamptz" },
  readings: { table: "interface_readings", where: "recorded_at < $1::timestamptz" },
  device_readings: { table: "device_readings", where: "recorded_at < $1::timestamptz" },
  // Devices left with nothing at or after the cut-off. Decided on the readings
  // the reset keeps, so the count before and the delete after agree.
  devices: {
    table: "devices",
    where:
      "NOT EXISTS (SELECT 1 FROM device_readings r WHERE r.mac = devices.mac AND r.recorded_at >= $1::timestamptz)",
  },
  daily_windows: { table: "daily_windows", where: "window_date < $2::date" },
  alerts: { table: "alerts", where: "created_at < $1::timestamptz" },
  cycle_alerts: { table: "cycle_alerts", where: "cycle_start < $2::date" },
  outage_causes: { table: "outage_causes", where: "silence_from < $1::timestamptz" },
};

/** Sessions that began before the cut-off and were still up at it. */
const SPANNING = "started_at < $1::timestamptz AND (ended_at IS NULL OR ended_at >= $1::timestamptz)";

/**
 * A session that crosses the cut-off keeps its row and its raw counters, and
 * becomes the part of itself after the cut-off: it starts at the cut-off and
 * its totals are recomputed from the readings the reset keeps. The first kept
 * reading counts as zero, exactly as the pages will count it once the earlier
 * readings are gone, so the session and the usage figures agree.
 *
 * An open session the router has been silent on since before the cut-off ends
 * up empty and "seen" at the cut-off, which is the nearest true thing that
 * keeps started_at <= last_seen_at.
 */
const TRIM_SESSIONS = `
  WITH spanning AS (
    SELECT id, interface_name, COALESCE(ended_at, last_seen_at) AS finished
    FROM sessions
    WHERE ${SPANNING}
  ),
  r AS (
    SELECT interface_name, recorded_at, tx_bytes, rx_bytes,
           LAG(tx_bytes) OVER w AS prev_tx,
           LAG(rx_bytes) OVER w AS prev_rx
    FROM interface_readings
    WHERE recorded_at >= $1::timestamptz
    WINDOW w AS (PARTITION BY interface_name ORDER BY recorded_at, id)
  ),
  totals AS (
    SELECT s.id,
           COALESCE(SUM(CASE WHEN r.prev_tx IS NULL THEN 0
                             WHEN r.tx_bytes >= r.prev_tx THEN r.tx_bytes - r.prev_tx
                             ELSE r.tx_bytes END), 0)::bigint AS tx,
           COALESCE(SUM(CASE WHEN r.prev_rx IS NULL THEN 0
                             WHEN r.rx_bytes >= r.prev_rx THEN r.rx_bytes - r.prev_rx
                             ELSE r.rx_bytes END), 0)::bigint AS rx,
           COUNT(r.recorded_at)::int AS samples
    FROM spanning s
    LEFT JOIN r ON r.interface_name IS NOT DISTINCT FROM s.interface_name
               AND r.recorded_at <= s.finished
    GROUP BY s.id
  )
  UPDATE sessions SET
    started_at   = $1::timestamptz,
    last_seen_at = GREATEST(sessions.last_seen_at, $1::timestamptz),
    tx_bytes     = totals.tx,
    rx_bytes     = totals.rx,
    samples      = totals.samples
  FROM totals
  WHERE sessions.id = totals.id`;

/**
 * One step's statement. Table names are interpolated, not bound: they come
 * from the closed set above, never from a request.
 */
export function resetStepSql(step: ResetStep, mode: ResetMode): string {
  if (step === "sessions_trimmed") {
    return mode === "count"
      ? `SELECT COUNT(*)::int AS rows FROM sessions WHERE ${SPANNING}`
      : TRIM_SESSIONS;
  }
  const { table, where } = DELETES[step];
  return mode === "count"
    ? `SELECT COUNT(*)::int AS rows FROM ${table} WHERE ${where}`
    : `DELETE FROM ${table} WHERE ${where}`;
}

/** Every count twin in one round trip, one column per step. */
export function previewSql(): string {
  const columns = RESET_STEPS.map((step) => `(${resetStepSql(step, "count")}) AS ${step}`);
  return `SELECT ${columns.join(",\n       ")}`;
}
