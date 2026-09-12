import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, isSecureRequest, readCookie } from "@/lib/auth/cookies";
import { revokeSession } from "@/lib/auth/sessions";
import { dictionaryFromRequest } from "@/lib/i18n/request";

/**
 * Revokes the session in the database and clears both cookies. Works whatever
 * state the cookies are in: an expired access token, a refresh token alone, or
 * nothing at all all end the same way, signed out.
 */
export async function POST(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  try {
    await revokeSession({
      access: readCookie(cookieHeader, ACCESS_COOKIE),
      refresh: readCookie(cookieHeader, REFRESH_COOKIE),
    });
  } catch (err) {
    return errorResponse(err, dictionaryFromRequest(request));
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response.cookies, isSecureRequest(request));
  return response;
}
