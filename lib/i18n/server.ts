/**
 * The active language, as seen from a Server Component.
 *
 * Every route lives under `app/[lang]`, which makes `lang` a root parameter, so
 * `next/root-params` hands it to any Server Component or server-side helper
 * without threading it through props. Root parameters are not available in
 * Route Handlers; those resolve a locale from the request instead, in
 * `lib/i18n/request.ts`.
 */

import { lang } from "next/root-params";
import { notFound } from "next/navigation";
import { DIRECTION, isLocale, type Direction, type Locale } from "@/lib/i18n/config";
import { getDictionaryFor, type Dictionary } from "@/lib/i18n";
import { makeFormatters, type Formatters } from "@/lib/i18n/format";

export interface ServerI18n {
  locale: Locale;
  dir: Direction;
  /** Every translated string. */
  d: Dictionary;
  /** Dates, durations and counts in the active language. */
  f: Formatters;
}

/**
 * A URL carrying a language we do not speak is a 404 rather than a silent
 * fallback: `/de/stats` is not this application's German page, it is a page
 * that does not exist, and answering it with English would leave that URL in
 * circulation and in search results.
 */
export async function getLocale(): Promise<Locale> {
  const value = await lang();
  if (typeof value !== "string" || !isLocale(value)) notFound();
  return value;
}

export async function getI18n(): Promise<ServerI18n> {
  const locale = await getLocale();
  const d = getDictionaryFor(locale);
  return { locale, dir: DIRECTION[locale], d, f: makeFormatters(locale, d) };
}

/** The dictionary alone, for callers that need no formatting. */
export async function getDictionary(): Promise<Dictionary> {
  return getDictionaryFor(await getLocale());
}
