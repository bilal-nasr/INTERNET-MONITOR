import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/server";
import { recordFailure, retryAfterSeconds } from "@/lib/auth/throttle";
import { maskEmail, parseCutoff } from "@/lib/data-reset";
import { createResetCode } from "@/lib/data-reset-store";
import { sendDataResetCodeEmail } from "@/lib/email";
import { fill, getDictionaryFor } from "@/lib/i18n";
import { makeFormatters } from "@/lib/i18n/format";
import { localeFromRequest } from "@/lib/i18n/request";
import { getSettings } from "@/lib/settings";

const bodySchema = z.object({ before: z.string().max(40) });

/**
 * Email the code that confirms deleting everything before `before`. It goes to
 * the account's address, or to the alert address when the account has none,
 * the same fallback the password reset uses.
 */
export async function POST(request: Request) {
  const locale = localeFromRequest(request);
  const d = getDictionaryFor(locale);

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

    const recipient = auth.user.email ?? settings.alert_email_to;
    if (!recipient) return badRequest(d.errors.resetNoRecipient);

    // Every send counts, as with the password reset: the cost is the email.
    const throttleKey = `data-reset-code:${auth.user.id}`;
    const wait = retryAfterSeconds(throttleKey);
    if (wait > 0) {
      return NextResponse.json(
        { error: "too_many_attempts", message: fill(d.errors.resetTooMany, { seconds: wait }) },
        { status: 429, headers: { "Retry-After": String(wait) } },
      );
    }
    recordFailure(throttleKey);

    const code = await createResetCode(auth.user.id, cutoff);
    const date = makeFormatters(locale, d).dayMonth(cutoff.toISOString(), settings.timezone);
    await sendDataResetCodeEmail(recipient, locale, auth.user.username, date, code);
    return NextResponse.json({ ok: true, sent_to: maskEmail(recipient) });
  } catch (err) {
    return errorResponse(err, d);
  }
}
