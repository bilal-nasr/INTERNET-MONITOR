import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, matchAcceptLanguage } from "@/lib/i18n/config";

/**
 * Every page lives under a language prefix, so a request without one has to be
 * sent to the right language before it can be rendered.
 *
 * A remembered choice wins over the browser's preference: someone who picked
 * Arabic from the switcher means it, whatever their `Accept-Language` says. The
 * API is excluded, since its callers include the router's push script, which
 * has no language at all.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const first = pathname.split("/")[1] ?? "";
  if (isLocale(first)) return NextResponse.next();

  const remembered = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale =
    remembered && isLocale(remembered)
      ? remembered
      : (matchAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LOCALE);

  const url = request.nextUrl.clone();
  url.pathname = pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * Everything except the API, Next's own assets, and files served from public.
   * A file is recognised by having a dot in its last segment, which keeps
   * favicon.ico and the SVGs in public/ from being redirected into a language.
   */
  matcher: ["/((?!api/|_next/|.*\\.[^/]*$).*)"],
};
