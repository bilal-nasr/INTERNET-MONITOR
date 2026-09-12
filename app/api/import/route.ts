/**
 * Loading an export back in.
 *
 * Takes the body of a file /api/export wrote -- CSV or JSON -- parses it with
 * the pure reader in lib/import/parse.ts, and inserts every reading the table
 * does not already hold. Re-importing the same file is therefore harmless: it
 * reports every row as skipped and changes nothing.
 */

import { NextResponse } from "next/server";
import type { ITask } from "pg-promise";
import { badRequest, errorResponse, rejectUnauthenticated } from "@/lib/api";
import { db, pgp } from "@/lib/db";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { dedupeRows, parseReadingsCsv, parseReadingsJson, type ImportRow } from "@/lib/import/parse";
import { thinningCutoff } from "@/lib/retention";
import { getSettings } from "@/lib/settings";

export const maxDuration = 300;

const MAX_BYTES = 50 * 1024 * 1024;
const BATCH = 2000;

// The cast keeps the column's type explicit even when every row in the batch
// carries a null name, which an export written before the interface_name
// column existed does.
const columns = new pgp.helpers.ColumnSet<ImportRow>(
  ["recorded_at", "tx_bytes", "rx_bytes", { name: "interface_name", cast: "text" }],
  { table: "interface_readings" },
);

/**
 * Insert one batch, skipping any reading the table already holds at the same
 * instant on the same interface. Done as INSERT ... SELECT over a VALUES list
 * rather than ON CONFLICT because the table has no unique constraint on
 * (recorded_at, interface_name) and adding one would fail on any existing
 * duplicate the router happened to push twice.
 *
 * The name the file gave is what the existence test compares, nulls included,
 * so a row from an export older than the interface_name column matches the
 * null-named row it was written from. Only the value being stored falls back
 * to the configured interface. Substituting before the test instead would
 * leave every such row matching nothing and inserted a second time, and since
 * traffic is read as counter growth along a per-interface chain, a second
 * chain counts the same growth twice.
 */
async function insertBatch(t: ITask<object>, rows: ImportRow[], fallback: string): Promise<number> {
  const values = pgp.helpers.values(rows, columns);
  // Both are written into the statement as finished literals rather than as
  // parameters: the row values are already formatted into `values`, and a
  // second formatting pass would look for variables inside them too.
  const name = pgp.as.text(fallback);
  const result = await t.result(
    `INSERT INTO interface_readings (recorded_at, tx_bytes, rx_bytes, interface_name)
     SELECT v.recorded_at::timestamptz, v.tx_bytes::bigint, v.rx_bytes::bigint,
            COALESCE(v.interface_name::text, ${name})
     FROM (VALUES ${values}) AS v(recorded_at, tx_bytes, rx_bytes, interface_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM interface_readings r
       WHERE r.recorded_at = v.recorded_at::timestamptz
         AND r.interface_name IS NOT DISTINCT FROM v.interface_name::text
     )`,
  );
  return result.rowCount;
}

export async function POST(request: Request) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", message: d.errors.importTooLarge }, { status: 413 });
  }

  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  const text = await request.text();
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", message: d.errors.importTooLarge }, { status: 413 });
  }

  let format: "csv" | "json";
  if (type.includes("text/csv")) format = "csv";
  else if (type.includes("application/json")) format = "json";
  else if (text.trimStart().startsWith("[")) format = "json";
  else if (type === "" || type.includes("text/plain")) format = "csv";
  else return NextResponse.json({ error: "unsupported_type", message: d.errors.importType }, { status: 415 });

  const parsed = format === "csv" ? parseReadingsCsv(text) : parseReadingsJson(text);
  if (parsed.rows.length === 0) {
    return badRequest(d.errors.importEmpty, { file: parsed.errors });
  }

  try {
    const settings = await getSettings();
    const fallback = settings.wan_interface_name;
    const rows = dedupeRows(parsed.rows, fallback);

    // The thinning job and the import feature pull in opposite directions: a
    // restored archive older than the retention cutoff is collapsed to one row
    // per hour by the next nightly run, within a day of the upload. Nothing can
    // stop that here -- retention is a setting, not an import option -- but the
    // response says exactly how many of the rows just written are in that
    // position, so the caller can raise Retention before the job runs rather
    // than discover the loss afterwards. The two groups are inserted
    // separately only so the count is the real inserted figure and not an
    // estimate over the file: rows already present are not counted.
    const cutoff = thinningCutoff(new Date(), settings.retention_days);
    const older = rows.filter((r) => r.recorded_at < cutoff);
    const newer = rows.filter((r) => r.recorded_at >= cutoff);

    let insertedBeforeCutoff = 0;
    let insertedAfterCutoff = 0;
    await db.tx(async (t) => {
      for (let i = 0; i < older.length; i += BATCH) {
        insertedBeforeCutoff += await insertBatch(t, older.slice(i, i + BATCH), fallback);
      }
      for (let i = 0; i < newer.length; i += BATCH) {
        insertedAfterCutoff += await insertBatch(t, newer.slice(i, i + BATCH), fallback);
      }
    });
    const inserted = insertedBeforeCutoff + insertedAfterCutoff;

    return NextResponse.json({
      inserted,
      skipped: parsed.rows.length - inserted,
      rejected: parsed.rejected,
      errors: parsed.errors,
      /** Imported rows the nightly thinning job will collapse to one per hour. */
      inserted_before_cutoff: insertedBeforeCutoff,
      thinning_cutoff: cutoff.toISOString(),
      retention_days: settings.retention_days,
    });
  } catch (err) {
    return errorResponse(err, d);
  }
}
