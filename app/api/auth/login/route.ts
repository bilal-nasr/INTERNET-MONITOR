import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, captchaFailed, errorResponse } from "@/lib/api";
import { isSecureRequest, setSessionCookies } from "@/lib/auth/cookies";
import { createSession, sessionMetaFromRequest } from "@/lib/auth/sessions";
import { clearFailures, recordFailure, retryAfterSeconds } from "@/lib/auth/throttle";
import { verifyCredentials } from "@/lib/auth/users";
import { fill } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { verifyTurnstile } from "@/lib/turnstile";

const bodySchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(1000),
  turnstile_token: z.string().max(2048).nullish(),
});

/**
 * Username and password in, two cookies out. The response body names the
 * account so the form can greet it, but the tokens travel only as cookies.
 */
export async function POST(request: Request) {
  const d = dictionaryFromRequest(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(d.errors.badJson);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(d.errors.validationFailed, {
      username: parsed.error.issues.some((i) => i.path[0] === "username") ? [d.errors.usernameRequired] : undefined,
      password: parsed.error.issues.some((i) => i.path[0] === "password") ? [d.errors.passwordRequired] : undefined,
    });
  }

  const meta = sessionMetaFromRequest(request);
  // Before the throttle: a request with no human behind it should not count
  // against the owner's own attempts.
  if (!(await verifyTurnstile(parsed.data.turnstile_token, meta.ip))) return captchaFailed(d);

  const throttleKey = `login:${meta.ip ?? "-"}:${parsed.data.username.toLowerCase()}`;
  const wait = retryAfterSeconds(throttleKey);
  if (wait > 0) {
    return NextResponse.json(
      { error: "too_many_attempts", message: fill(d.errors.tooManyAttempts, { seconds: wait }) },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }

  try {
    const user = await verifyCredentials(parsed.data.username, parsed.data.password);
    if (!user) {
      recordFailure(throttleKey);
      return NextResponse.json(
        { error: "invalid_credentials", message: d.errors.invalidCredentials },
        { status: 401 },
      );
    }
    clearFailures(throttleKey);

    const tokens = await createSession(user.id, meta);
    const response = NextResponse.json({ user });
    setSessionCookies(response.cookies, tokens, isSecureRequest(request));
    return response;
  } catch (err) {
    return errorResponse(err, d);
  }
}
