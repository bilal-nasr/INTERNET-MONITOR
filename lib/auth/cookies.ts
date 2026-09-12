/**
 * The two cookies a signed-in browser carries, and how they are written.
 *
 * Both are HttpOnly, so a script injected into the page cannot read them, and
 * SameSite=Lax, so a cross-site form post never carries them. `Secure` follows
 * the request rather than the environment: the dashboard is commonly opened over
 * plain HTTP on a LAN address, and a Secure cookie on HTTP is silently dropped
 * by the browser, which would make login impossible there.
 */

import type { IssuedAccess, IssuedTokens } from "@/lib/auth/sessions";

export const ACCESS_COOKIE = "qm_access";
export const REFRESH_COOKIE = "qm_refresh";

/** The subset of NextResponse.cookies and next/headers cookies() that is used here. */
export interface CookieSink {
  set(
    name: string,
    value: string,
    options: {
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "lax" | "strict" | "none";
      path?: string;
      maxAge?: number;
      expires?: Date;
    },
  ): unknown;
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  return new URL(request.url).protocol === "https:";
}

function base(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
}

export function setAccessCookie(sink: CookieSink, access: IssuedAccess, secure: boolean): void {
  sink.set(ACCESS_COOKIE, access.access, { ...base(secure), expires: access.accessExpiresAt });
}

export function setSessionCookies(sink: CookieSink, tokens: IssuedTokens, secure: boolean): void {
  setAccessCookie(sink, tokens, secure);
  sink.set(REFRESH_COOKIE, tokens.refresh, { ...base(secure), expires: tokens.refreshExpiresAt });
}

export function clearSessionCookies(sink: CookieSink, secure: boolean): void {
  sink.set(ACCESS_COOKIE, "", { ...base(secure), maxAge: 0 });
  sink.set(REFRESH_COOKIE, "", { ...base(secure), maxAge: 0 });
}

/** Read one cookie from a raw Cookie header, for code that has a Request but no cookie store. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key.trim() === name) return decodeURIComponent(rest.join("=").trim());
  }
  return null;
}
