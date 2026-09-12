import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse } from "@/lib/api";
import { createPasswordReset } from "@/lib/auth/reset";
import { sessionMetaFromRequest } from "@/lib/auth/sessions";
import { recordFailure, retryAfterSeconds } from "@/lib/auth/throttle";
import { findUserByUsername } from "@/lib/auth/users";
import { sendPasswordResetEmail } from "@/lib/email";
import { fill } from "@/lib/i18n";
import { dictionaryFromRequest, localeFromRequest } from "@/lib/i18n/request";
import { getSettings } from "@/lib/settings";

const bodySchema = z.object({
  username: z.string().trim().min(1).max(100),
});

/**
 * Where the reset link points. APP_URL when the operator set one, since that
 * is the address they want in an email; otherwise the address this request
 * arrived on, honouring a reverse proxy's forwarded headers.
 */
function publicBaseUrl(request: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

/**
 * Email a reset link. The answer is the same whether or not the username
 * exists, so the form cannot be used to list accounts; only a failure to
 * deliver is reported, because on a single-owner install the person asking is
 * the owner and needs to know the mail never left.
 */
export async function POST(request: Request) {
  const d = dictionaryFromRequest(request);
  const locale = localeFromRequest(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(d.errors.badJson);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(d.errors.validationFailed, { username: [d.errors.usernameRequired] });
  }

  // Every request counts against the limit, not just failed ones: the cost
  // here is the email, and five an hour per address is plenty.
  const throttleKey = `forgot:${sessionMetaFromRequest(request).ip ?? "-"}`;
  const wait = retryAfterSeconds(throttleKey);
  if (wait > 0) {
    return NextResponse.json(
      { error: "too_many_attempts", message: fill(d.errors.tooManyAttempts, { seconds: wait }) },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }
  recordFailure(throttleKey);

  try {
    const user = await findUserByUsername(parsed.data.username);
    if (user) {
      const recipient = user.email ?? (await getSettings()).alert_email_to;
      if (recipient) {
        const token = await createPasswordReset(user.id);
        const link = `${publicBaseUrl(request)}/${locale}/reset-password?token=${token}`;
        await sendPasswordResetEmail(recipient, locale, user.username, link);
      } else {
        console.warn(`[auth] password reset requested for ${user.username} but no email is on file`);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, d);
  }
}
