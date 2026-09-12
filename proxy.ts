import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  isSecureRequest,
  setAccessCookie,
} from "@/lib/auth/cookies";
import { AUTH_CONTEXT_HEADER, encodeAuthContext } from "@/lib/auth/context-header";
import {
  authenticateAccess,
  refreshAccess,
  type AuthContext,
  type RefreshResult,
} from "@/lib/auth/sessions";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, matchAcceptLanguage } from "@/lib/i18n/config";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { isPublicApiPath } from "@/lib/share";

/**
 * Two jobs, in this order: put every page under a language, then let nobody
 * past without a session.
 *
 * A remembered language wins over the browser's preference: someone who picked
 * Arabic from the switcher means it, whatever their `Accept-Language` says.
 *
 * The session check reads the access cookie and, when that has lapsed, mints a
 * new one from the refresh cookie on the spot, so a returning browser never
 * sees the login page as long as its refresh token is alive. A request with
 * neither is sent to the login page (a page) or answered 401 (the API). The
 * router's push to /api/ingest carries a bearer token instead and is let
 * through untouched, as are the health probe and the auth endpoints themselves.
 * The share page and its feed carry a token in the path and check it themselves.
 *
 * What the lookup found is handed to the page in a request header, so the
 * render does not repeat it. Every forwarded request has that header rewritten
 * here, whether or not anyone is signed in, so a copy sent by a client is
 * never the one a page reads.
 */

/** Routes that must work with no session: the router, the probe, and signing in. */
const PUBLIC_API = new Set([
  "/api/ingest",
  "/api/ingest/devices",
  "/api/health",
  "/api/cron/tick",
  "/api/metrics",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/refresh",
  "/api/auth/forgot",
  "/api/auth/reset",
]);

/** Page segments under /[lang] that render signed out. */
const PUBLIC_PAGES = new Set(["login", "forgot-password", "reset-password", "share"]);

interface Session {
  context: AuthContext;
  /** Set when the access token had to be minted from the refresh token. */
  refreshed: RefreshResult | null;
  refreshToken: string | null;
}

async function resolveSession(request: NextRequest): Promise<Session | null> {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  if (access) {
    const context = await authenticateAccess(access);
    if (context) return { context, refreshed: null, refreshToken: null };
  }

  const refresh = request.cookies.get(REFRESH_COOKIE)?.value ?? null;
  if (!refresh) return null;
  const refreshed = await refreshAccess(refresh);
  return refreshed ? { context: refreshed.context, refreshed, refreshToken: refresh } : null;
}

/**
 * Continue to the route, signed out. The auth header is removed rather than
 * left alone so a client cannot plant one.
 */
function passThrough(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(AUTH_CONTEXT_HEADER);
  return NextResponse.next({ request: { headers } });
}

/**
 * Continue to the route, signed in. The verified session travels in a request
 * header. After a refresh the new token is also written to the response for
 * the browser, and into the request's own Cookie header, so the render that
 * follows reads the live token rather than the lapsed one.
 */
function proceed(request: NextRequest, session: Session, secure: boolean): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(AUTH_CONTEXT_HEADER, encodeAuthContext(session.context));

  if (!session.refreshed || !session.refreshToken) {
    return NextResponse.next({ request: { headers } });
  }

  const others = request.cookies
    .getAll()
    .filter((c) => c.name !== ACCESS_COOKIE)
    .map((c) => `${c.name}=${c.value}`);
  headers.set("cookie", [...others, `${ACCESS_COOKIE}=${session.refreshed.access}`].join("; "));

  const response = NextResponse.next({ request: { headers } });
  setAccessCookie(response.cookies, session.refreshed, secure);
  // Same refresh token, later expiry.
  response.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: session.refreshed.refreshExpiresAt,
  });
  return response;
}

async function handleApi(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  // The share feed carries its own credential in the path and checks it
  // itself; every other route under /api/share stays behind the session.
  if (PUBLIC_API.has(pathname) || isPublicApiPath(pathname)) return passThrough(request);

  const secure = isSecureRequest(request);
  const session = await resolveSession(request);
  if (!session) {
    const d = dictionaryFromRequest(request);
    const response = NextResponse.json(
      { error: "unauthorized", message: d.errors.unauthorized },
      { status: 401 },
    );
    clearSessionCookies(response.cookies, secure);
    return response;
  }
  return proceed(request, session, secure);
}

async function handlePage(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const segments = pathname.split("/");
  const first = segments[1] ?? "";

  if (!isLocale(first)) {
    const remembered = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale =
      remembered && isLocale(remembered)
        ? remembered
        : (matchAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LOCALE);
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
    return NextResponse.redirect(url);
  }

  const locale = first;
  const page = segments[2] ?? "";
  const secure = isSecureRequest(request);
  const session = await resolveSession(request);

  if (PUBLIC_PAGES.has(page)) {
    // Already signed in: the login page has nothing to offer, go to the dashboard.
    if (session && page === "login") {
      return NextResponse.redirect(new URL(`/${locale}`, request.url));
    }
    return session ? proceed(request, session, secure) : passThrough(request);
  }

  if (!session) {
    const url = new URL(`/${locale}/login`, request.url);
    // Come back to this page after signing in, unless it was the dashboard anyway.
    if (segments.length > 2 && page !== "") url.searchParams.set("next", `${pathname}${search}`);
    const response = NextResponse.redirect(url);
    // Whatever was there is dead; drop it so the next request is clean.
    clearSessionCookies(response.cookies, secure);
    return response;
  }
  return proceed(request, session, secure);
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) return handleApi(request);
  return handlePage(request);
}

export const config = {
  /**
   * Everything except Next's own assets and files served from public. A file
   * is recognised by having a dot in its last segment, which keeps favicon.ico
   * and the SVGs in public/ from being redirected into a language. The API is
   * included: it is where the session check for fetches from the browser lives.
   */
  matcher: ["/((?!_next/|.*\\.[^/]*$).*)"],
};
