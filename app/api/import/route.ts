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
import { parseReadingsCsv, parseReadingsJson, type ImportRow } from "@/lib/import/parse";
import { getSettings } from "@/lib/settings";

export const maxDuration = 300;

const MAX_BYTES = 50 * 1024 * 1024;
const BATCH = 2000;

const columns = new pgp.helpers.ColumnSet<ImportRow>(
  ["recorded_at", "tx_bytes", "rx_bytes", "interface_name"],
  { table: "interface_readings" },
);

/**
 * Insert one batch, skipping any reading the table already holds at the same
 * instant on the same interface. Done as INSERT ... SELECT over a VALUES list
 * rather than ON CONFLICT because the table has no unique constraint on
 * (recorded_at, interface_name) and adding one would fail on any existing
 * duplicate the router happened to push twice.
 */
async function insertBatch(t: ITask<object>, rows: ImportRow[]): Promise<number> {
  const values = pgp.helpers.values(rows, columns);
  const result = await t.result(
    `INSERT INTO interface_readings (recorded_at, tx_bytes, rx_bytes, interface_name)
     SELECT v.recorded_at::timestamptz, v.tx_bytes::bigint, v.rx_bytes::bigint, v.interface_name::text
     FROM (VALUES ${values}) AS v(recorded_at, tx_bytes, rx_bytes, interface_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM interface_readings r
       WHERE r.recorded_at = v.recorded_at::timestamptz
         AND r.interface_name IS NOT DISTINCT FROM v.interface_name::text
     )`,
  );
  return result.rowCount;
}

/** A file can repeat a reading; only the first copy is offered to the database. */
function dedupe(rows: ImportRow[]): ImportRow[] {
  const seen = new Set<string>();
  const out: ImportRow[] = [];
  for (const row of rows) {
    const key = `${row.recorded_at.toISOString()}|${row.interface_name ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
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
    const rows = dedupe(
      parsed.rows.map((r) => ({ ...r, interface_name: r.interface_name ?? settings.wan_interface_name })),
    );

    let inserted = 0;
    await db.tx(async (t) => {
      for (let i = 0; i < rows.length; i += BATCH) {
        inserted += await insertBatch(t, rows.slice(i, i + BATCH));
      }
    });

    return NextResponse.json({
      inserted,
      skipped: parsed.rows.length - inserted,
      rejected: parsed.rejected,
      errors: parsed.errors,
    });
  } catch (err) {
    return errorResponse(err, d);
  }
}
