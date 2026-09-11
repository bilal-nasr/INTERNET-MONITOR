import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { fill } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { getSelectedSessionTotals } from "@/lib/stats";

/** Selecting every row of the longest page the sessions table will show. */
const MAX_IDS = 1000;

/**
 * Totals for an explicit set of sessions, summed in the database.
 *
 * The browser already holds each visible session's counters, but summing there
 * would only ever total the rows currently on screen. Asking the database means
 * a selection is exact whatever the table happens to be showing.
 */
export async function GET(request: Request) {
  const d = dictionaryFromRequest(request);
  const raw = new URL(request.url).searchParams.get("ids")?.trim() ?? "";
  if (raw === "") return NextResponse.json(await getSelectedSessionTotals([]));

  const parts = raw.split(",");
  if (parts.length > MAX_IDS) return badRequest(fill(d.errors.tooManyIds, { max: MAX_IDS }));

  const ids: number[] = [];
  for (const part of parts) {
    const id = Number(part);
    if (!Number.isInteger(id) || id < 1) {
      return badRequest(fill(d.errors.notASessionId, { value: `"${part}"` }));
    }
    ids.push(id);
  }

  try {
    return NextResponse.json(await getSelectedSessionTotals([...new Set(ids)]));
  } catch (err) {
    return errorResponse(err, d);
  }
}
