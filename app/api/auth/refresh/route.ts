import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import {
  REFRESH_COOKIE,
  clearSessionCookies,
  isSecureRequest,
  readCookie,
  setAccessCookie,
} from "@/lib/auth/cookies";
import { refreshAccess } from "@/lib/auth/sessions";
import { dictionaryFromRequest } from "@/lib/i18n/request";

/**
 * Trade the refresh cookie for a new access cookie. The proxy does this on its
 * own for any request that arrives with a lapsed access token, so a browser
 * rarely needs to call this; it exists for a client that wants to refresh
 * explicitly, and as the documented shape of the flow.
 */
export async function POST(request: Request) {
  const d = dictionaryFromRequest(request);
  const secure = isSecureRequest(request);
  const refresh = readCookie(request.headers.get("cookie"), REFRESH_COOKIE);
  try {
    const result = await refreshAccess(refresh);
    if (!result || !refresh) {
      const response = NextResponse.json(
        { error: "unauthorized", message: d.errors.unauthorized },
        { status: 401 },
      );
      clearSessionCookies(response.cookies, secure);
      return response;
    }
    const response = NextResponse.json({ user: result.context.user });
    setAccessCookie(response.cookies, result, secure);
    // The refresh token is unchanged; only its expiry has slid forward.
    response.cookies.set(REFRESH_COOKIE, refresh, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: result.refreshExpiresAt,
    });
    return response;
  } catch (err) {
    return errorResponse(err, d);
  }
}
