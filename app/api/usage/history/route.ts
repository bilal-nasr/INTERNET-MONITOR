import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { getDailyHistory } from "@/lib/usage";

const MAX_DAYS = 365;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("days") ?? "30";
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return badRequest(`days must be an integer between 1 and ${MAX_DAYS}`);
  }
  try {
    const settings = await getSettings();
    const history = await getDailyHistory(days, settings.timezone);
    return NextResponse.json({ days, timezone: settings.timezone, history });
  } catch (err) {
    return errorResponse(err);
  }
}
