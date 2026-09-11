/**
 * Locale-aware formatting of the values on these pages.
 *
 * One bundle per locale, built once and shared, so a table of two hundred rows
 * constructs its `Intl.DateTimeFormat` objects once rather than per cell.
 *
 * What is translated and what is not is a deliberate split. Month and weekday
 * names are words, so they follow the language. Digits, and the units attached
 * to them (GB, MB, TB, B), are measurements that also appear in the database
 * and in every export, so they stay Latin in both languages and a figure read
 * on screen matches the figure in a CSV.
 *
 * Intl is used to answer one question only: which calendar day and clock time
 * an instant falls on in a given timezone. The words are then taken from the
 * dictionary and the string is composed here. Letting Intl name the month too
 * would put two spellings of September on the statistics page, because the
 * chart axis labels its buckets from the dictionary and `en-GB` writes "Sept".
 */

import type { Direction, Locale } from "@/lib/i18n/config";
import { DIRECTION } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { formatDuration } from "@/lib/time";

export interface Formatters {
  locale: Locale;
  dir: Direction;
  /** "2d 3h 14m" in English, "2ي 3س 14د" in Arabic. Null-safe. */
  duration(seconds: number | null | undefined): string;
  /** "14:05" */
  clock(iso: string, timeZone: string): string;
  /** "14:05:09" */
  clockWithSeconds(iso: string, timeZone: string): string;
  /** "11 Sep" */
  dayMonth(iso: string, timeZone: string): string;
  /** "14:05, 11 Sep" */
  stamp(iso: string, timeZone: string): string;
  /** "11 Sep, 14:05" */
  dayMonthClock(iso: string, timeZone: string): string;
  /** Grouped digits, always Latin: "12,480". */
  count(value: number): string;
}

interface Parts {
  day: string;
  /** 1-12, for indexing the dictionary's month names. */
  month: number;
  year: string;
  hour: string;
  minute: string;
  second: string;
}

/**
 * A fixed locale for the numbers, whatever language the page is in: these parts
 * are read back as integers and re-composed, so they must be Latin digits.
 * `en-GB` also fixes the clock at 24 hours, which is how every time on these
 * pages is written.
 */
const PARTS_LOCALE = "en-GB";

function partsReader(): (iso: string, timeZone: string) => Parts {
  const cache = new Map<string, Intl.DateTimeFormat>();
  return (iso, timeZone) => {
    let fmt = cache.get(timeZone);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat(PARTS_LOCALE, {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
      cache.set(timeZone, fmt);
    }
    const found: Record<string, string> = {};
    for (const part of fmt.formatToParts(new Date(iso))) {
      if (part.type !== "literal") found[part.type] = part.value;
    }
    return {
      day: found.day,
      month: Number(found.month),
      year: found.year,
      hour: found.hour,
      minute: found.minute,
      second: found.second,
    };
  };
}

export function makeFormatters(locale: Locale, d: Dictionary): Formatters {
  const read = partsReader();
  const units = d.duration;
  // Grouping separators are part of how a number reads, but the digits are not:
  // en-GB gives "12,480" and keeps Arabic reading the same figure as the export.
  const number = new Intl.NumberFormat(PARTS_LOCALE);

  const clock = (p: Parts) => `${p.hour}:${p.minute}`;
  const dayMonth = (p: Parts) => `${p.day} ${d.monthsShort[p.month - 1]}`;

  return {
    locale,
    dir: DIRECTION[locale],
    duration: (seconds) => formatDuration(seconds, units),
    clock: (iso, tz) => clock(read(iso, tz)),
    clockWithSeconds: (iso, tz) => {
      const p = read(iso, tz);
      return `${clock(p)}:${p.second}`;
    },
    dayMonth: (iso, tz) => dayMonth(read(iso, tz)),
    stamp: (iso, tz) => {
      const p = read(iso, tz);
      return `${clock(p)}, ${dayMonth(p)}`;
    },
    dayMonthClock: (iso, tz) => {
      const p = read(iso, tz);
      return `${dayMonth(p)}, ${clock(p)}`;
    },
    count: (value) => number.format(value),
  };
}
