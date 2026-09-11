"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DIRECTION, type Direction, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";
import { makeFormatters, type Formatters } from "@/lib/i18n/format";

/**
 * The active language, made available to every Client Component.
 *
 * The layout is a Server Component and resolves the dictionary there, so only
 * the language actually being shown crosses into the browser. The dictionary is
 * plain data, which is what lets it cross at all; the formatters are functions,
 * so they are rebuilt here rather than passed.
 */

export interface I18n {
  locale: Locale;
  dir: Direction;
  d: Dictionary;
  f: Formatters;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: ReactNode;
}) {
  const value = useMemo<I18n>(
    () => ({
      locale,
      dir: DIRECTION[locale],
      d: dictionary,
      f: makeFormatters(locale, dictionary),
    }),
    [locale, dictionary],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be called inside <I18nProvider>, which the root layout mounts");
  }
  return value;
}
