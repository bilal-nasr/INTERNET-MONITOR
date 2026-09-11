import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { getTodayUsage } from "@/lib/usage";

export async function GET() {
  try {
    const settings = await getSettings();
    const usage = await getTodayUsage(settings);
    return NextResponse.json(usage);
  } catch (err) {
    return errorResponse(err);
  }
}
