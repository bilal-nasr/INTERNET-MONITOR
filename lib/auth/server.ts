/**
 * Who is signed in, as seen from server code.
 *
 * The proxy looks the access token up before a page renders and forwards what
 * it found in a request header, so a Server Component reads that rather than
 * asking the database a second time. A request that somehow escapes the
 * proxy's matcher carries no such header and is treated as signed out, so the
 * shortcut cannot turn into a leak. Route Handlers see the raw request and
 * still check the cookie against the database themselves.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { AUTH_CONTEXT_HEADER, decodeAuthContext } from "@/lib/auth/context-header";
import { ACCESS_COOKIE, readCookie } from "@/lib/auth/cookies";
import { authenticateAccess, type AuthContext } from "@/lib/auth/sessions";
import { getLocale } from "@/lib/i18n/server";

export class UnauthorizedError extends Error {
  constructor() {
    super("not signed in");
    this.name = "UnauthorizedError";
  }
}

/** For Server Components. Cached per request, so the layout and a page share one decode. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  return decodeAuthContext((await headers()).get(AUTH_CONTEXT_HEADER));
});

/**
 * For a layout or page that must not render signed out. The proxy adds the
 * return path when it redirects; here there is no request URL to read, so the
 * login page opens on the dashboard afterwards.
 */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect(`/${await getLocale()}/login`);
  return auth;
}

/** For Route Handlers, which see the raw request rather than a cookie store. */
export async function requireApiAuth(request: Request): Promise<AuthContext> {
  const token = readCookie(request.headers.get("cookie"), ACCESS_COOKIE);
  const auth = await authenticateAccess(token);
  if (!auth) throw new UnauthorizedError();
  return auth;
}
