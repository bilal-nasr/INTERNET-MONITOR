import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { getSettings, getShareToken } from "@/lib/settings";
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
 *
 * The token is read from the database rather than from the cached settings
 * row, so a link that was replaced or turned off stops working here at once
 * instead of at the end of this instance's memo. A dictionary is passed to
 * `errorResponse` for the same reason the token is: this route answers
 * anonymous callers, and the untranslated branch would hand them the driver's
 * own text.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const d = dictionaryFromRequest(request);
  const { token } = await params;
  try {
    if (!tokensMatch(token, await getShareToken())) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    const settings = await getSettings();
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
    return errorResponse(err, d);
  }
}
