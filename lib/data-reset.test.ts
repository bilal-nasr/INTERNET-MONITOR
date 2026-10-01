import { describe, expect, test } from "vitest";
import {
  CODE_TTL_SECONDS,
  MAX_CODE_ATTEMPTS,
  codesMatch,
  cutoffLocalDate,
  finishedCycles,
  parseCutoff,
  generateCode,
  hashCode,
  isDeletableCutoff,
  looksLikeCode,
  maskEmail,
  previewSql,
  RESET_STEPS,
  resetStepSql,
} from "@/lib/data-reset";

const TZ = "Asia/Beirut"; // UTC+3 in September and early October

describe("finishedCycles", () => {
  const now = new Date("2026-10-10T09:00:00Z");

  test("lists finished cycles with data, newest first, never the running one", () => {
    const cycles = finishedCycles(now, new Date("2026-08-20T00:00:00Z"), 6, TZ);
    expect(cycles.map((c) => [c.start.toISOString(), c.end.toISOString()])).toEqual([
      ["2026-09-05T21:00:00.000Z", "2026-10-05T21:00:00.000Z"],
      ["2026-08-05T21:00:00.000Z", "2026-09-05T21:00:00.000Z"],
    ]);
  });

  test("stops at the cycle that holds the first data", () => {
    const cycles = finishedCycles(now, new Date("2026-09-10T19:00:00Z"), 6, TZ);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].end.toISOString()).toBe("2026-10-05T21:00:00.000Z");
  });

  test("data that only starts in the running cycle leaves nothing to delete", () => {
    expect(finishedCycles(now, new Date("2026-10-06T10:00:00Z"), 6, TZ)).toEqual([]);
  });

  test("no data at all leaves nothing to delete", () => {
    expect(finishedCycles(now, null, 6, TZ)).toEqual([]);
  });

  test("before the rollover, the cycle being tested is still running", () => {
    const before = new Date("2026-10-05T20:59:59Z"); // 23:59:59 on the 5th in Beirut
    expect(finishedCycles(before, new Date("2026-09-10T19:00:00Z"), 6, TZ)).toEqual([]);
  });
});

describe("isDeletableCutoff", () => {
  const now = new Date("2026-10-10T09:00:00Z");

  test("the end of a finished cycle is deletable", () => {
    expect(isDeletableCutoff(new Date("2026-10-05T21:00:00Z"), now, 6, TZ)).toBe(true);
    expect(isDeletableCutoff(new Date("2026-09-05T21:00:00Z"), now, 6, TZ)).toBe(true);
  });

  test("the end of the running cycle is not", () => {
    expect(isDeletableCutoff(new Date("2026-11-05T22:00:00Z"), now, 6, TZ)).toBe(false);
  });

  test("an instant that is not a cycle boundary is not", () => {
    expect(isDeletableCutoff(new Date("2026-10-05T21:00:01Z"), now, 6, TZ)).toBe(false);
    expect(isDeletableCutoff(new Date("2026-10-04T21:00:00Z"), now, 6, TZ)).toBe(false);
  });

  test("an invalid date is not", () => {
    expect(isDeletableCutoff(new Date("nope"), now, 6, TZ)).toBe(false);
  });
});

describe("parseCutoff", () => {
  const now = new Date("2026-10-10T09:00:00Z");

  test("accepts the ISO form of a deletable cut-off", () => {
    expect(parseCutoff("2026-10-05T21:00:00.000Z", now, 6, TZ)?.toISOString()).toBe(
      "2026-10-05T21:00:00.000Z",
    );
  });

  test("rejects anything else", () => {
    expect(parseCutoff("2026-11-05T22:00:00.000Z", now, 6, TZ)).toBeNull();
    expect(parseCutoff("tomorrow", now, 6, TZ)).toBeNull();
    expect(parseCutoff(1759698000000, now, 6, TZ)).toBeNull();
    expect(parseCutoff(undefined, now, 6, TZ)).toBeNull();
  });
});

describe("cutoffLocalDate", () => {
  test("is the date on the local calendar, not in UTC", () => {
    expect(cutoffLocalDate(new Date("2026-10-05T21:00:00Z"), TZ)).toBe("2026-10-06");
  });
});

describe("codes", () => {
  test("a generated code is six digits", () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  test("looksLikeCode accepts six digits only", () => {
    expect(looksLikeCode("012345")).toBe(true);
    expect(looksLikeCode("12345")).toBe(false);
    expect(looksLikeCode("1234567")).toBe(false);
    expect(looksLikeCode("12a456")).toBe(false);
    expect(looksLikeCode(123456)).toBe(false);
  });

  test("the hash binds the code to its cut-off", () => {
    const cutoff = new Date("2026-10-05T21:00:00Z");
    const stored = hashCode("123456", cutoff);
    expect(codesMatch(stored, hashCode("123456", cutoff))).toBe(true);
    expect(codesMatch(stored, hashCode("123457", cutoff))).toBe(false);
    expect(codesMatch(stored, hashCode("123456", new Date("2026-09-05T21:00:00Z")))).toBe(false);
  });

  test("the hash never contains the code", () => {
    expect(hashCode("123456", new Date("2026-10-05T21:00:00Z"))).not.toContain("123456");
  });

  test("limits are what the card promises", () => {
    expect(CODE_TTL_SECONDS).toBe(600);
    expect(MAX_CODE_ATTEMPTS).toBe(5);
  });
});

describe("maskEmail", () => {
  test("keeps the first letter and the domain", () => {
    expect(maskEmail("bilal@example.com")).toBe("b•••@example.com");
  });

  test("leaves something that is not an address alone", () => {
    expect(maskEmail("nobody")).toBe("nobody");
  });
});

describe("reset SQL", () => {
  test("every step has a count twin that deletes nothing", () => {
    for (const step of RESET_STEPS) {
      const count = resetStepSql(step, "count");
      expect(count).toMatch(/COUNT\(\*\)/);
      expect(count).not.toMatch(/\b(DELETE|UPDATE)\b/);
    }
  });

  test("the twins share their predicate", () => {
    for (const step of RESET_STEPS) {
      if (step === "sessions_trimmed") continue;
      const del = resetStepSql(step, "delete");
      const where = del.slice(del.indexOf("WHERE"));
      expect(resetStepSql(step, "count")).toContain(where);
    }
  });

  test("an open session is never deleted, only trimmed", () => {
    expect(resetStepSql("sessions", "delete")).toContain("ended_at IS NOT NULL");
    const trim = resetStepSql("sessions_trimmed", "delete");
    expect(trim).toMatch(/^\s*WITH/);
    expect(trim).toContain("UPDATE sessions");
    expect(trim).toContain("ended_at IS NULL OR");
    // Recomputed only from readings the reset keeps, so the totals match the
    // pages afterwards.
    expect(trim).toContain("recorded_at >= $1::timestamptz");
    // The raw counters are what the next push is measured against.
    expect(trim).not.toContain("last_tx_counter");
  });

  test("the session trim runs before the readings it reads are deleted", () => {
    expect(RESET_STEPS.indexOf("sessions_trimmed")).toBeLessThan(RESET_STEPS.indexOf("readings"));
  });

  test("date-keyed tables compare against the local date", () => {
    expect(resetStepSql("daily_windows", "delete")).toContain("window_date < $2::date");
    expect(resetStepSql("cycle_alerts", "delete")).toContain("cycle_start < $2::date");
  });

  test("the preview is a single statement with one column per step", () => {
    const sql = previewSql();
    for (const step of RESET_STEPS) expect(sql).toContain(`AS ${step}`);
    expect(sql).not.toMatch(/\b(DELETE|UPDATE)\b/);
  });
});
