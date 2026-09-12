import { db } from "@/lib/db";
import { classifySilence, isSilence, type CauseSegment, type RouterEvidence } from "@/lib/outage-cause";
import type { StoredSilence } from "@/lib/outages";
import type { SessionWindow } from "@/lib/sessions";

/**
 * The database side of outage causes: keep the router's last report, and when a
 * push ends a silence, store what the router says happened during it.
 */

interface SilenceRow {
  silence_from: Date;
  silence_to: Date;
  segments: CauseSegment[];
}

function toStored(row: SilenceRow): StoredSilence {
  return {
    silence_from: row.silence_from.toISOString(),
    silence_to: row.silence_to.toISOString(),
    segments: row.segments,
  };
}

// Only ever forwards: a retried or overtaken push must not replace a newer
// report. Shared by recordRouterEvidence and noteRouterStatus so the SQL
// exists once.
async function upsertRouterStatus(evidence: RouterEvidence, at: Date): Promise<void> {
  await db.none(
    `INSERT INTO router_status (id, recorded_at, evidence) VALUES (1, $1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET recorded_at = EXCLUDED.recorded_at, evidence = EXCLUDED.evidence
     WHERE router_status.recorded_at < EXCLUDED.recorded_at`,
    [at, JSON.stringify(evidence)],
  );
}

/**
 * Called by /api/ingest while polling is paused: keeps router_status current
 * without classifying anything, so the first push after resuming does not see
 * a gap spanning the whole pause and record it as a silence. Never throws.
 */
export async function noteRouterStatus(evidence: RouterEvidence, at: Date): Promise<void> {
  // An old script sends no uptime: there is nothing to keep.
  if (evidence.uptime_s === null) return;
  try {
    await upsertRouterStatus(evidence, at);
  } catch (err) {
    console.warn("[ingest] could not record router status", err);
  }
}

/**
 * Called by /api/ingest after the reading is stored. Never throws: the push has
 * already done the part that matters, and a failure here only costs a label.
 */
export async function recordRouterEvidence(
  evidence: RouterEvidence,
  at: Date,
): Promise<"skipped" | "none" | "classified" | "failed"> {
  // An old script sends no uptime: there is nothing to keep or compare.
  if (evidence.uptime_s === null) return "skipped";
  try {
    const previous = await db.oneOrNone<{ recorded_at: Date; evidence: RouterEvidence }>(
      "SELECT recorded_at, evidence FROM router_status WHERE id = 1",
    );

    let outcome: "none" | "classified" = "none";
    if (previous && isSilence(previous.recorded_at, at)) {
      const segments = classifySilence({ from: previous.recorded_at, to: at, before: previous.evidence, after: evidence });
      const inserted = await db.result(
        `INSERT INTO outage_causes (silence_from, silence_to, segments, evidence_before, evidence_after)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
         ON CONFLICT (silence_from) DO NOTHING`,
        [previous.recorded_at, at, JSON.stringify(segments), JSON.stringify(previous.evidence), JSON.stringify(evidence)],
      );
      // A retried or overtaken push can find the row already there: ON
      // CONFLICT DO NOTHING then inserts nothing, and that push classified
      // nothing new.
      outcome = inserted.rowCount > 0 ? "classified" : "none";
    }

    await upsertRouterStatus(evidence, at);
    return outcome;
  } catch (err) {
    console.warn("[ingest] could not record outage evidence", err);
    return "failed";
  }
}

/** Silences overlapping the window, oldest first. */
export async function getSilences({ from, to }: SessionWindow): Promise<StoredSilence[]> {
  const rows = await db.any<SilenceRow>(
    `SELECT silence_from, silence_to, segments FROM outage_causes
     WHERE silence_to >= COALESCE($1::timestamptz, '-infinity'::timestamptz)
       AND silence_from < $2::timestamptz
     ORDER BY silence_from`,
    [from, to],
  );
  return rows.map(toStored);
}

/**
 * The silence that began with the reading at `at`. The stale job knows that
 * reading's time from its complaint; the silence starts at the same push, so the
 * few seconds of slack only absorb rounding.
 */
export async function findSilenceStartingAt(at: Date): Promise<StoredSilence | null> {
  const row = await db.oneOrNone<SilenceRow>(
    `SELECT silence_from, silence_to, segments FROM outage_causes
     WHERE silence_from BETWEEN $1::timestamptz - INTERVAL '5 seconds' AND $1::timestamptz + INTERVAL '5 seconds'
     ORDER BY silence_from
     LIMIT 1`,
    [at],
  );
  return row ? toStored(row) : null;
}
