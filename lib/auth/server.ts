/**
 * Who is signed in, as seen from server code.
 *
 * The proxy has already turned away anyone without a live token before a page
 * or a route handler runs, but nothing here relies on that: every caller checks
 * again against the database. It costs one indexed lookup and means a page
 * that somehow escapes the proxy's matcher is still not a leak.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ACCESS_COOKIE, readCookie } from "@/lib/auth/cookies";
import { authenticateAccess, type AuthContext } from "@/lib/auth/sessions";
import { getLocale } from "@/lib/i18n/server";

export class UnauthorizedError extends Error {
  constructor() {
    super("not signed in");
    this.name = "UnauthorizedError";
  }
}

/** For Server Components. Cached per request, so the layout and a page share one lookup. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  return authenticateAccess(token);
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
