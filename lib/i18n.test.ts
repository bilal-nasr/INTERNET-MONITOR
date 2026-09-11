import { describe, expect, test } from "vitest";
import { fill, getDictionaryFor, plural } from "@/lib/i18n";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { LOCALES, isLocale, matchAcceptLanguage } from "@/lib/i18n/config";
import { makeFormatters } from "@/lib/i18n/format";

describe("fill", () => {
  test("replaces every placeholder with its value", () => {
    expect(fill("{a} of {b}", { a: "1 GB", b: "8 GB" })).toBe("1 GB of 8 GB");
  });

  test("uses the same value everywhere it appears", () => {
    expect(fill("{n} and {n}", { n: 2 })).toBe("2 and 2");
  });

  test("leaves a placeholder standing when nothing was supplied", () => {
    // Visible in the page rather than a silent hole, so the gap gets noticed.
    expect(fill("day {day}", {})).toBe("day {day}");
  });
});

describe("plural", () => {
  test("English picks singular and plural", () => {
    expect(plural("en", en.sessions.sessionsCount, 1)).toBe("1 session");
    expect(plural("en", en.sessions.sessionsCount, 3)).toBe("3 sessions");
  });

  test("Arabic distinguishes zero, one, two, few, many and the rest", () => {
    // A period is phrased grammatically, so it uses the full set of categories.
    const forms = ar.common.lastNDays;
    expect(plural("ar", forms, 1)).toBe("آخر يوم");
    expect(plural("ar", forms, 2)).toBe("آخر يومين");
    expect(plural("ar", forms, 5)).toBe("آخر 5 أيام");
    expect(plural("ar", forms, 30)).toBe("آخر 30 يوماً");
  });

  test("a reported count names what is counted and puts the number last", () => {
    // Chosen over grammatical agreement for the figures the pages report: the
    // label stays put while the number ticks, rather than the sentence around
    // it rewriting itself between one refresh and the next.
    const forms = ar.sessions.sessionsCount;
    for (const count of [0, 1, 2, 5, 30]) {
      expect(plural("ar", forms, count)).toBe(`عدد الجلسات: ${count}`);
    }
  });

  test("falls back to `other` when a language leaves a category out", () => {
    // English has no `two`, and CLDR never asks it for one; asking anyway must
    // still produce a sentence rather than undefined.
    expect(plural("en", { other: "{count} items" }, 2)).toBe("2 items");
  });
});

describe("dictionaries", () => {
  /** Every leaf, keyed by its path, so two languages can be compared entry by entry. */
  function leaves(value: unknown, path = "", out = new Map<string, string>()) {
    if (typeof value === "string") {
      out.set(path, value);
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => leaves(item, `${path}[${i}]`, out));
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        leaves(child, path ? `${path}.${key}` : key, out);
      }
    }
    return out;
  }

  const english = leaves(en);
  const arabic = leaves(ar);

  /**
   * A plural category other than `other` is optional in any language: CLDR
   * decides which ones a language uses, and a language may also choose an
   * invariant phrasing that needs only `other`.
   */
  const optional = /\.(zero|one|two|few|many)$/;

  test("every English entry has an Arabic one", () => {
    const missing = [...english.keys()].filter((key) => !arabic.has(key) && !optional.test(key));
    expect(missing).toEqual([]);
  });

  test("a counted phrase always has the form that covers every other number", () => {
    const plurals = new Set(
      [...english.keys(), ...arabic.keys()]
        .filter((key) => optional.test(key) || key.endsWith(".other"))
        .map((key) => key.replace(/\.\w+$/, "")),
    );
    for (const base of plurals) {
      expect(arabic.has(`${base}.other`)).toBe(true);
      expect(english.has(`${base}.other`)).toBe(true);
    }
  });

  test("no entry is left in English", () => {
    // Placeholder names are code, not words, so they are removed before asking
    // whether what is left is still English. An entry that is nothing but
    // placeholders and punctuation is rightly identical in both languages.
    const words = (text: string) => text.replace(/\{\w+\}/g, " ");
    const untranslated = [...arabic.entries()].filter(
      ([key, value]) => english.get(key) === value && /[A-Za-z]{4,}/.test(words(value)),
    );
    expect(untranslated.map(([key]) => key)).toEqual([]);
  });

  test("Arabic never invents a placeholder English does not supply", () => {
    // Only this direction is an error. The reverse is legitimate: Arabic says
    // "one session" as a word rather than as "1 session", so its `one` form
    // drops {count} on purpose.
    const marks = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const invented = [...arabic.entries()]
      .filter(([key, value]) => {
        const source = english.get(key);
        if (source === undefined) return false;
        const allowed = new Set(marks(source));
        return marks(value).some((name) => !allowed.has(name));
      })
      .map(([key]) => key);
    expect(invented).toEqual([]);
  });

  test("a counted phrase keeps its number in the form that needs one", () => {
    // `other` covers every count the named categories do not, so it can never
    // spell the number out and must carry {count}.
    const missing = [...english.entries()]
      .filter(([key]) => key.endsWith(".other"))
      .flatMap(([key]) => {
        const value = arabic.get(key);
        return value !== undefined && !value.includes("{count}") ? [key] : [];
      });
    expect(missing).toEqual([]);
  });

  test("every supported locale resolves to a dictionary", () => {
    for (const locale of LOCALES) {
      expect(getDictionaryFor(locale).nav.dashboard.length).toBeGreaterThan(0);
    }
  });
});

describe("matchAcceptLanguage", () => {
  test("matches a regional tag on its language", () => {
    expect(matchAcceptLanguage("ar-LB,ar;q=0.9")).toBe("ar");
  });

  test("honours quality order rather than position", () => {
    expect(matchAcceptLanguage("fr;q=0.9,ar;q=0.2,en;q=0.8")).toBe("en");
  });

  test("returns null when nothing is on offer", () => {
    expect(matchAcceptLanguage("fr-FR,de;q=0.8")).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
  });

  test("isLocale rejects a language the application does not speak", () => {
    expect(isLocale("de")).toBe(false);
    expect(isLocale("ar")).toBe(true);
  });
});

describe("formatters", () => {
  const at = "2026-09-11T18:05:09Z";

  test("Arabic dates carry Arabic months and Latin digits", () => {
    const f = makeFormatters("ar", ar);
    const shown = f.dayMonth(at, "UTC");
    expect(shown).toContain("سبتمبر");
    expect(shown).toContain("11");
    // A figure on screen has to match the same figure in an export.
    expect(shown).not.toMatch(/[٠-٩]/);
  });

  test("English dates stay day-before-month on a 24-hour clock", () => {
    const f = makeFormatters("en", en);
    expect(f.dayMonth(at, "UTC")).toBe("11 Sep");
    expect(f.clock(at, "UTC")).toBe("18:05");
    expect(f.clockWithSeconds(at, "UTC")).toBe("18:05:09");
    expect(f.dayMonthClock(at, "UTC")).toBe("11 Sep, 18:05");
  });

  test("a month is spelled the same way everywhere it appears", () => {
    // The statistics page puts a chart axis, which labels buckets from the
    // dictionary, beside a table of timestamps. One spelling, or the same month
    // reads as two.
    const f = makeFormatters("en", en);
    expect(f.dayMonth(at, "UTC").endsWith(en.monthsShort[8])).toBe(true);
  });

  test("a timestamp is read in the timezone it is asked for", () => {
    const f = makeFormatters("en", en);
    expect(f.clock(at, "Asia/Beirut")).toBe("21:05");
    expect(f.clock(at, "UTC")).toBe("18:05");
  });

  test("durations take their suffixes from the language", () => {
    expect(makeFormatters("en", en).duration(93_784)).toBe("1d 2h 3m");
    expect(makeFormatters("ar", ar).duration(93_784)).toBe("1ي 2س 3د");
  });

  test("counts are grouped the same way in both languages", () => {
    expect(makeFormatters("en", en).count(12480)).toBe("12,480");
    expect(makeFormatters("ar", ar).count(12480)).toBe("12,480");
  });
});
