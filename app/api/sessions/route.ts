import { NextResponse } from "next/server";
import { badRequest, errorResponse, rejectUnauthenticated } from "@/lib/api";
import { fill, getDictionaryFor, plural } from "@/lib/i18n";
import { localeFromRequest } from "@/lib/i18n/request";
import {
  InvalidRangeError,
  rangeErrorMessage,
  rangeLabel,
  resolveRange,
} from "@/lib/range";
import { getSessions, getSessionTotals, type SessionWindow } from "@/lib/sessions";
import { getSettings } from "@/lib/settings";

const MAX_LIMIT = 1000;
const MAX_DAYS = 3650;

/**
 * Sessions and their totals for one time range.
 *
 * Takes the same `range`, `from` and `to` parameters as /api/stats. `days=N` is
 * still accepted, for bookmarks and scripts written against the earlier shape,
 * and simply means the last N times twenty-four hours.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locale = localeFromRequest(request);
  const d = getDictionaryFor(locale);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;
  const limit = Number(params.get("limit") ?? "200");

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return badRequest(fill(d.errors.limitRange, { max: MAX_LIMIT }));
  }

  try {
    const settings = await getSettings();
    const rawDays = params.get("days");
    const useDays = rawDays !== null && params.get("range") === null;

    let window: SessionWindow;
    let label: string;
    let preset: string;

    if (useDays) {
      const days = Number(rawDays);
      if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
        return badRequest(fill(d.errors.daysRange, { max: MAX_DAYS }));
      }
      const to = new Date();
      window = { from: new Date(to.getTime() - days * 86_400_000), to };
      label = plural(locale, d.common.lastNDays, days);
      preset = "custom";
    } else {
      const range = resolveRange(
        {
          range: params.get("range"),
          from: params.get("from"),
          to: params.get("to"),
        },
        { timezone: settings.timezone, cycleDay: settings.billing_cycle_day },
      );
      window = { from: range.from, to: range.to };
      label = rangeLabel(d, range.preset);
      preset = range.preset;
    }

    const [sessions, totals] = await Promise.all([
      getSessions(window, limit),
      getSessionTotals(window),
    ]);

    return NextResponse.json({
      range: {
        preset,
        label,
        from: window.from?.toISOString() ?? null,
        to: window.to.toISOString(),
      },
      timezone: settings.timezone,
      totals,
      sessions,
    });
  } catch (err) {
    if (err instanceof InvalidRangeError) return badRequest(rangeErrorMessage(d, err));
    return errorResponse(err, d);
  }
}
