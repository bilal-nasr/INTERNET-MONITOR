import { NextResponse } from "next/server";
import { badRequest, errorResponse, rejectUnauthenticated } from "@/lib/api";
import { listAlerts, type AlertLogRow } from "@/lib/alerts/log";
import { fill } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";

const MAX_LIMIT = 500;

export interface PublicAlert extends Omit<AlertLogRow, "created_at"> {
  created_at: string;
}

export function toPublicAlert(row: AlertLogRow): PublicAlert {
  return { ...row, created_at: row.created_at.toISOString() };
}

export async function GET(request: Request) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const limitRaw = params.get("limit") ?? "100";
  const beforeRaw = params.get("before");
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return badRequest(fill(d.errors.limitRange, { max: MAX_LIMIT }));
  }
  const before = beforeRaw === null ? null : Number(beforeRaw);
  if (before !== null && (!Number.isInteger(before) || before < 1)) {
    return badRequest(d.errors.validationFailed);
  }

  try {
    const rows = await listAlerts(limit, before);
    return NextResponse.json({ alerts: rows.map(toPublicAlert) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, d);
  }
}
