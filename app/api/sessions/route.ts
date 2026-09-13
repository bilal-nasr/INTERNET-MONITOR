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
import { getSessionsPage, getSessionTotals, type SessionWindow } from "@/lib/sessions";
import { getSettings } from "@/lib/settings";

const MAX_LIMIT = 1000;
const MAX_DAYS = 3650;

/**
 * Sessions and their totals for one time range.
 *
 * Takes the same `range`, `from` and `to` parameters as /api/stats. `days=N` is
 * still accepted, for bookmarks and scripts written against the earlier shape,
 * and simply means the last N times twenty-four hours.
 *
 * Paged newest first by cursor: `limit` rows, and `next_cursor` to pass back as
 * `before` for the rows after them (null on the last page). `totals=0` skips
 * the range totals, which a caller turning pages already has.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locale = localeFromRequest(request);
  const d = getDictionaryFor(locale);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;
  const limit = Number(params.get("limit") ?? "200");
  const beforeRaw = params.get("before");
  const before = beforeRaw === null ? null : Number(beforeRaw);
  const withTotals = params.get("totals") !== "0";

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return badRequest(fill(d.errors.limitRange, { max: MAX_LIMIT }));
  }
  if (before !== null && (!Number.isInteger(before) || before < 1)) {
    return badRequest(fill(d.errors.notASessionId, { value: beforeRaw ?? "" }));
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

    const [page, totals] = await Promise.all([
      getSessionsPage(window, { limit, beforeId: before }),
      withTotals ? getSessionTotals(window) : null,
    ]);

    return NextResponse.json({
      range: {
        preset,
        label,
        from: window.from?.toISOString() ?? null,
        to: window.to.toISOString(),
      },
      timezone: settings.timezone,
      ...(totals ? { totals } : {}),
      sessions: page.sessions,
      next_cursor: page.next_cursor,
    });
  } catch (err) {
    if (err instanceof InvalidRangeError) return badRequest(rangeErrorMessage(d, err));
    return errorResponse(err, d);
  }
}
