import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { tokensMatch } from "@/lib/share";
import { getCycleUsage } from "@/lib/stats";
import { getTodayUsage } from "@/lib/usage";

export const maxDuration = 30;

/**
 * Today's window usage and the billing cycle, for anything that polls: a Home
 * Assistant REST sensor, a status widget. The token in the path is the only
 * credential. A wrong token is a 404 rather than a 401 so the response does
 * not confirm that sharing exists at all. Nothing from settings beyond the
 * figures themselves is returned: no email, no interface name, no thresholds.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const settings = await getSettings();
    if (!tokensMatch(token, settings.share_token)) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    const now = new Date();
    const [today, cycle] = await Promise.all([
      getTodayUsage(settings, now),
      getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone, now),
    ]);
    return NextResponse.json(
      { generated_at: now.toISOString(), today, cycle },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
