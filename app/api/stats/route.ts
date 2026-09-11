import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { InvalidRangeError, rangeErrorMessage, resolveRange } from "@/lib/range";
import { buildStatsReport } from "@/lib/report";
import { getSettings } from "@/lib/settings";

/**
 * Every statistic for one time range.
 *
 * Query parameters: `range` (a preset name), `from` and `to` (required when
 * range is `custom`), and `bucket` to override the automatic series grouping.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const d = dictionaryFromRequest(request);

  try {
    const settings = await getSettings();
    const range = resolveRange(
      {
        range: params.get("range"),
        from: params.get("from"),
        to: params.get("to"),
        bucket: params.get("bucket"),
      },
      { timezone: settings.timezone, cycleDay: settings.billing_cycle_day },
    );
    return NextResponse.json(await buildStatsReport(settings, range, d));
  } catch (err) {
    if (err instanceof InvalidRangeError) return badRequest(rangeErrorMessage(d, err));
    return errorResponse(err, d);
  }
}
