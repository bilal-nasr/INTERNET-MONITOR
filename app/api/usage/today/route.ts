import { NextResponse } from "next/server";
import { errorResponse, rejectUnauthenticated } from "@/lib/api";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { getSettings } from "@/lib/settings";
import { getTodayUsage } from "@/lib/usage";

export async function GET(request: Request) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;
  try {
    const settings = await getSettings();
    const usage = await getTodayUsage(settings);
    return NextResponse.json(usage);
  } catch (err) {
    return errorResponse(err, d);
  }
}
