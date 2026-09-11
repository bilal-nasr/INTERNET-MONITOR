/**
 * The language a Route Handler should answer in.
 *
 * `next/root-params` does not reach Route Handlers, and the API is not under
 * `/[lang]` anyway, so the locale is read from the request itself. In order of
 * authority: an explicit `?lang=`, the cookie the language switcher writes, and
 * finally the browser's `Accept-Language`.
 *
 * The router's own pushes carry none of these and land on the default, which is
 * correct: nothing it posts to is ever read by a person.
 */

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  matchAcceptLanguage,
  type Locale,
} from "@/lib/i18n/config";
import { getDictionaryFor, type Dictionary } from "@/lib/i18n";

export function localeFromRequest(request: Request): Locale {
  const explicit = new URL(request.url).searchParams.get("lang");
  if (explicit && isLocale(explicit)) return explicit;

  const cookie = readCookie(request.headers.get("cookie"), LOCALE_COOKIE);
  if (cookie && isLocale(cookie)) return cookie;

  return matchAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LOCALE;
}

export function dictionaryFromRequest(request: Request): Dictionary {
  return getDictionaryFor(localeFromRequest(request));
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key.trim() === name) return decodeURIComponent(rest.join("=").trim());
  }
  return null;
}
