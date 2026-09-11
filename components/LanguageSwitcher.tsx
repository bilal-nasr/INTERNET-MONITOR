"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, isLocale, type Locale } from "@/lib/i18n/config";
import { fill } from "@/lib/i18n";

/**
 * Switching language keeps you on the page you were reading.
 *
 * These are links rather than buttons, so the other language has a real URL
 * that can be opened in a new tab, bookmarked or shared. The query string comes
 * along too: a statistics page is a range as much as it is a page, and losing
 * the range on a language change would throw away what the reader had chosen.
 */
export function LanguageSwitcher() {
  const { locale, d } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();

  const query = params.toString();
  const rest = stripLocale(pathname);

  return (
    <div className="flex items-center gap-1" role="group" aria-label={d.language.label}>
      {LOCALES.map((option) => {
        const current = option === locale;
        return (
          <Link
            key={option}
            href={`/${option}${rest}${query ? `?${query}` : ""}`}
            hrefLang={option}
            lang={option}
            onClick={() => remember(option)}
            aria-current={current ? "true" : undefined}
            title={fill(d.language.switchTo, { language: LOCALE_NAMES[option] })}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              current
                ? "bg-foreground text-background"
                : "border border-border text-muted hover:bg-border/60 hover:text-foreground"
            }`}
          >
            {LOCALE_NAMES[option]}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Remember the choice, so a later visit with no language in the path lands on
 * it. A year, because this is a preference rather than a session fact; Lax so
 * it survives following a link in from elsewhere, which is exactly when someone
 * arrives at a bare URL.
 */
function remember(next: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}

/** "/ar/sessions" -> "/sessions", and "/ar" -> "". */
function stripLocale(pathname: string): string {
  const segments = pathname.split("/");
  if (isLocale(segments[1] ?? "")) segments.splice(1, 1);
  const rest = segments.join("/");
  return rest === "/" ? "" : rest;
}
