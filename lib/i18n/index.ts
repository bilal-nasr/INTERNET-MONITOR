/**
 * Looking a translation up, and filling it in.
 *
 * Dictionaries are plain data rather than functions, because a Server Component
 * hands one straight to a Client Component and only serialisable values survive
 * that boundary. Interpolation and plural selection therefore live here, as
 * free functions both sides can call.
 */

import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en, type Dictionary, type PluralForms } from "@/lib/i18n/dictionaries/en";

const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

export function getDictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export type { Dictionary, PluralForms };

type Value = string | number;

/**
 * Replace every `{name}` in a template with the matching value.
 *
 * A placeholder with no value is left standing rather than blanked, so a
 * missing variable shows up as `{name}` in the page instead of a hole nobody
 * notices.
 */
export function fill(template: string, values: Record<string, Value> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

/**
 * Choose the wording a count calls for, then fill it in.
 *
 * English needs two forms; Arabic needs six, and which one applies is a rule of
 * the language rather than of the phrase, so `Intl.PluralRules` decides and the
 * dictionary only supplies wording. A language missing the category the rules
 * pick falls back to `other`, which every entry must carry.
 */
export function plural(
  locale: Locale,
  forms: PluralForms,
  count: number,
  values: Record<string, Value> = {},
): string {
  const category = new Intl.PluralRules(locale).select(count);
  const template = forms[category] ?? forms.other;
  return fill(template, { count, ...values });
}
