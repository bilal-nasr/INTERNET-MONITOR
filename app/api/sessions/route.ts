import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { getSessions, getSessionTotals } from "@/lib/sessions";
import { getSettings } from "@/lib/settings";

const MAX_DAYS = 3650;
const MAX_LIMIT = 1000;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const days = Number(params.get("days") ?? "30");
  const limit = Number(params.get("limit") ?? "200");

  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return badRequest(`days must be an integer between 1 and ${MAX_DAYS}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return badRequest(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }

  try {
    const [settings, sessions, totals] = await Promise.all([
      getSettings(),
      getSessions(days, limit),
      getSessionTotals(days),
    ]);
    return NextResponse.json({ days, timezone: settings.timezone, totals, sessions });
  } catch (err) {
    return errorResponse(err);
  }
}
