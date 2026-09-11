/**
 * Which languages the application speaks, and how each one is written.
 *
 * Kept free of any dictionary import so a Client Component can read it without
 * pulling the translations into its bundle.
 */

export const LOCALES = ["en", "ar"] as const;

export type Locale = (typeof LOCALES)[number];

export type Direction = "ltr" | "rtl";

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Where a chosen language is remembered. Written by the language switcher and
 * read by the proxy, so a visitor who picked Arabic lands on Arabic next time
 * even when their browser asks for English.
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export const DIRECTION: Record<Locale, Direction> = {
  en: "ltr",
  ar: "rtl",
};

/** Each language named in itself, which is how a language switcher should read. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ar: "العربية",
};

/**
 * Pick the best supported locale from an Accept-Language header.
 *
 * Quality values are honoured, and a tag is matched on its language subtag, so
 * `ar-LB` selects Arabic. Returns null when the header asks for nothing we have.
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const quality = q ? Number(q.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((entry) => entry.tag !== "" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const language = tag.split("-")[0];
    if (isLocale(language)) return language;
  }
  return null;
}
