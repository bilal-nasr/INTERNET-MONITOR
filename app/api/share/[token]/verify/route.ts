import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, captchaFailed, errorResponse } from "@/lib/api";
import { isSecureRequest } from "@/lib/auth/cookies";
import { sessionMetaFromRequest } from "@/lib/auth/sessions";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { getShareToken } from "@/lib/settings";
import { tokensMatch } from "@/lib/share";
import { SHARE_PASS_COOKIE, SHARE_PASS_TTL_SECONDS, issueSharePass, verifyTurnstile } from "@/lib/turnstile";

const bodySchema = z.object({
  turnstile_token: z.string().max(2048),
});

/**
 * Trade a passed Turnstile check for a share pass: a cookie that lets this
 * browser open the share page for the next few hours without being asked
 * again. The JSON feed beside it is not gated, since what polls it is a Home
 * Assistant sensor and not a browser.
 *
 * A wrong token is a 404, as on the page and the feed, and is checked before
 * Cloudflare is asked so a guessed link costs no siteverify call.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const d = dictionaryFromRequest(request);
  const { token } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(d.errors.badJson);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return captchaFailed(d);

  try {
    const shareToken = await getShareToken();
    if (!shareToken || !tokensMatch(token, shareToken)) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (!(await verifyTurnstile(parsed.data.turnstile_token, sessionMetaFromRequest(request).ip))) {
      return captchaFailed(d);
    }

    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    const pass = issueSharePass(shareToken);
    if (pass) {
      response.cookies.set(SHARE_PASS_COOKIE, pass, {
        httpOnly: true,
        secure: isSecureRequest(request),
        sameSite: "lax",
        path: "/",
        maxAge: SHARE_PASS_TTL_SECONDS,
      });
    }
    return response;
  } catch (err) {
    return errorResponse(err, d);
  }
}
