/**
 * The database side of deleting old data: what there is, the emailed code,
 * and the reset itself. The rules and statements are in lib/data-reset.ts.
 */

import { db } from "@/lib/db";
import {
  CODE_TTL_SECONDS,
  MAX_CODE_ATTEMPTS,
  RESET_STEPS,
  codesMatch,
  generateCode,
  hashCode,
  previewSql,
  resetStepSql,
  type ResetCounts,
} from "@/lib/data-reset";
import { SESSION_LOCK_KEY } from "@/lib/sessions";

/** The earliest thing the reset would remove, whichever table holds it. */
export async function getFirstDataAt(): Promise<Date | null> {
  const row = await db.one<{ at: Date | null }>(
    `SELECT LEAST(
       (SELECT MIN(recorded_at) FROM interface_readings),
       (SELECT MIN(started_at)  FROM sessions),
       (SELECT MIN(created_at)  FROM alerts),
       (SELECT MIN(silence_from) FROM outage_causes)
     ) AS at`,
  );
  return row.at;
}

/** How many rows each step would touch. Reads only. */
export function previewReset(cutoff: Date, cutoffDate: string): Promise<ResetCounts> {
  return db.one<ResetCounts>(previewSql(), [cutoff, cutoffDate]);
}

/** A fresh code for this cut-off. Asking again cancels the code before it. */
export async function createResetCode(userId: number, cutoff: Date, now = new Date()): Promise<string> {
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_SECONDS * 1000);
  await db.tx(async (t) => {
    await t.none(`UPDATE data_reset_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    await t.none(
      `INSERT INTO data_reset_codes (user_id, cutoff, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [userId, cutoff, hashCode(code, cutoff), expiresAt],
    );
  });
  return code;
}

export type ResetOutcome =
  | { status: "deleted"; counts: ResetCounts }
  | { status: "wrong"; attemptsLeft: number }
  | { status: "expired" }
  | { status: "locked" };

/**
 * Spend the code and, when it is right, delete everything before the cut-off.
 *
 * One transaction: the code is marked used in the same commit that removes
 * the rows, so a failure part way leaves both the data and the code as they
 * were. A wrong guess returns normally rather than throwing, so the attempt
 * it used is committed.
 */
export function confirmReset(
  userId: number,
  cutoff: Date,
  cutoffDate: string,
  code: string,
): Promise<ResetOutcome> {
  return db.tx(async (t): Promise<ResetOutcome> => {
    const row = await t.oneOrNone<{ id: number; code_hash: string; attempts: number }>(
      `SELECT id, code_hash, attempts FROM data_reset_codes
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
       ORDER BY id DESC LIMIT 1
       FOR UPDATE`,
      [userId],
    );
    if (!row) return { status: "expired" };
    if (row.attempts >= MAX_CODE_ATTEMPTS) return { status: "locked" };

    if (!codesMatch(row.code_hash, hashCode(code, cutoff))) {
      await t.none(`UPDATE data_reset_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      return { status: "wrong", attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - row.attempts - 1) };
    }
    await t.none(`UPDATE data_reset_codes SET used_at = now() WHERE id = $1`, [row.id]);

    // The trim rewrites the open session, which every push also writes. Holding
    // the ingest's lock keeps a push from landing between the trim and the
    // delete of the readings it was computed from.
    await t.one("SELECT pg_advisory_xact_lock($1)", [SESSION_LOCK_KEY]);

    const counts = {} as ResetCounts;
    for (const step of RESET_STEPS) {
      counts[step] = (await t.result(resetStepSql(step, "delete"), [cutoff, cutoffDate])).rowCount;
    }
    return { status: "deleted", counts };
  });
}
