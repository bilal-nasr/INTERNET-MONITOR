import { NextResponse } from "next/server";
import { badRequest, errorResponse, rejectUnauthenticated } from "@/lib/api";
import { fill } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { getSettings } from "@/lib/settings";
import { getDailyHistory } from "@/lib/usage";

const MAX_DAYS = 365;

export async function GET(request: Request) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get("days") ?? "30";
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return badRequest(fill(d.errors.daysRange, { max: MAX_DAYS }));
  }
  try {
    const settings = await getSettings();
    const history = await getDailyHistory(days, settings.timezone);
    return NextResponse.json({ days, timezone: settings.timezone, history });
  } catch (err) {
    return errorResponse(err, d);
  }
}
