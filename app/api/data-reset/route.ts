import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, rejectUnauthenticated } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/server";
import { cutoffLocalDate, finishedCycles, looksLikeCode, parseCutoff, removedRows } from "@/lib/data-reset";
import { confirmReset, getFirstDataAt, previewReset } from "@/lib/data-reset-store";
import { fill } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { getSettings } from "@/lib/settings";

/**
 * Deleting everything before the end of a finished cycle (lib/data-reset.ts).
 *
 * GET lists the finished cycles that still hold data; GET ?before=<instant>
 * counts what a reset at that cut-off would remove. POST spends the emailed
 * code from /api/data-reset/code and, when it is right, does the reset.
 */
export async function GET(request: Request) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;
  try {
    const settings = await getSettings();
    const now = new Date();
    const before = new URL(request.url).searchParams.get("before");

    if (before === null) {
      const cycles = finishedCycles(now, await getFirstDataAt(), settings.billing_cycle_day, settings.timezone);
      return NextResponse.json({
        cycles: cycles.map((c) => ({ start: c.start.toISOString(), end: c.end.toISOString() })),
      });
    }

    const cutoff = parseCutoff(before, now, settings.billing_cycle_day, settings.timezone);
    if (!cutoff) return badRequest(d.errors.resetCutoffInvalid);
    return NextResponse.json({ counts: await previewReset(cutoff, cutoffLocalDate(cutoff, settings.timezone)) });
  } catch (err) {
    return errorResponse(err, d);
  }
}

const bodySchema = z.object({ before: z.string().max(40), code: z.string().max(20) });

function codeError(error: string, message: string): NextResponse {
  return NextResponse.json({ error, message }, { status: 400 });
}

export async function POST(request: Request) {
  const d = dictionaryFromRequest(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(d.errors.badJson);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return badRequest(d.errors.validationFailed);

  try {
    const auth = await requireApiAuth(request);
    const settings = await getSettings();
    const cutoff = parseCutoff(parsed.data.before, new Date(), settings.billing_cycle_day, settings.timezone);
    if (!cutoff) return badRequest(d.errors.resetCutoffInvalid);
    const code = parsed.data.code.trim();
    if (!looksLikeCode(code)) return codeError("code_format", d.errors.resetCodeFormat);

    const outcome = await confirmReset(auth.user.id, cutoff, cutoffLocalDate(cutoff, settings.timezone), code);
    switch (outcome.status) {
      case "deleted": {
        const total = removedRows(outcome.counts);
        console.info(`[data-reset] ${auth.user.username} deleted ${total} rows before ${cutoff.toISOString()}`);
        return NextResponse.json({ ok: true, counts: outcome.counts, total });
      }
      case "wrong":
        return codeError("code_wrong", fill(d.errors.resetCodeWrong, { left: outcome.attemptsLeft }));
      case "locked":
        return codeError("code_locked", d.errors.resetCodeLocked);
      case "expired":
        return codeError("code_expired", d.errors.resetCodeExpired);
    }
  } catch (err) {
    return errorResponse(err, d);
  }
}
