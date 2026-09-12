import { describe, expect, test } from "vitest";
import {
  DEVICE_TARGET,
  INTERFACE_TARGET,
  isThinBudgetSpent,
  isThinDue,
  daysToThinSql,
  pruneDevicesSql,
  thinDaySql,
  thinningCutoff,
  THINNED_SAMPLE_GAP_SECONDS,
  THIN_INTERVAL_MS,
  THIN_TIME_BUDGET_MS,
} from "@/lib/retention";
import { MAX_SAMPLE_GAP_SECONDS } from "@/lib/stats";

describe("thinningCutoff", () => {
  test("is now minus the retention, truncated to the hour", () => {
    const now = new Date("2026-09-12T11:48:31.250Z");
    expect(thinningCutoff(now, 90).toISOString()).toBe("2026-06-14T11:00:00.000Z");
  });

  test("truncation drops minutes and seconds, never rounds up", () => {
    const now = new Date("2026-09-12T23:59:59.999Z");
    expect(thinningCutoff(now, 7).toISOString()).toBe("2026-09-05T23:00:00.000Z");
  });

  test("a whole-hour instant is unchanged", () => {
    const now = new Date("2026-09-12T10:00:00.000Z");
    expect(thinningCutoff(now, 1).toISOString()).toBe("2026-09-11T10:00:00.000Z");
  });
});

describe("isThinDue", () => {
  const now = new Date("2026-09-12T12:00:00Z");

  test("due when it has never run", () => {
    expect(isThinDue(null, now)).toBe(true);
  });

  test("not due within a day of the last run", () => {
    expect(isThinDue(new Date(now.getTime() - THIN_INTERVAL_MS + 1000), now)).toBe(false);
  });

  test("due once a full day has passed", () => {
    expect(isThinDue(new Date(now.getTime() - THIN_INTERVAL_MS), now)).toBe(true);
  });
});

describe("isThinBudgetSpent", () => {
  test("false while the tick is inside its budget", () => {
    expect(isThinBudgetSpent(1_000, 1_000 + THIN_TIME_BUDGET_MS - 1)).toBe(false);
  });

  test("true once the budget is reached, so the day loop stops itself", () => {
    expect(isThinBudgetSpent(1_000, 1_000 + THIN_TIME_BUDGET_MS)).toBe(true);
  });

  test("the budget leaves room inside the route's sixty-second cap", () => {
    expect(THIN_TIME_BUDGET_MS).toBeLessThanOrEqual(30_000);
  });

  test("an explicit budget overrides the default", () => {
    expect(isThinBudgetSpent(0, 5, 10)).toBe(false);
    expect(isThinBudgetSpent(0, 10, 10)).toBe(true);
  });
});

describe("thinning statements", () => {
  const targets = [INTERFACE_TARGET, DEVICE_TARGET];

  test("a day is chosen only when some hour of it holds more than one reading", () => {
    for (const target of targets) {
      const sql = daysToThinSql(target);
      expect(sql).toContain(`FROM ${target.table}`);
      expect(sql).toContain(`GROUP BY ${target.partition}, date_trunc('hour', recorded_at)`);
      expect(sql).toContain("WHERE n > 1");
      expect(sql).toContain("recorded_at < $1::timestamptz");
      expect(sql).not.toMatch(/\bDELETE\b/);
    }
  });

  test("the delete keeps the newest reading of every chain and hour", () => {
    for (const target of targets) {
      const sql = thinDaySql(target, "delete");
      expect(sql).toContain(`PARTITION BY ${target.partition}, date_trunc('hour', recorded_at)`);
      expect(sql).toContain("ORDER BY recorded_at DESC, id DESC");
      expect(sql).toContain(`DELETE FROM ${target.table}`);
      // rn = 1 is the survivor; only later rows of the same hour go.
      expect(sql).toContain("WHERE rn > 1");
    }
  });

  test("the delete never reaches past the cutoff or beyond one day", () => {
    for (const target of targets) {
      const sql = thinDaySql(target, "delete");
      expect(sql).toContain("recorded_at >= $1::timestamptz");
      expect(sql).toContain("LEAST($1::timestamptz + INTERVAL '1 day', $2::timestamptz)");
    }
  });

  test("the dry run counts the same rows and removes none", () => {
    for (const target of targets) {
      const count = thinDaySql(target, "count");
      const remove = thinDaySql(target, "delete");
      expect(count).not.toMatch(/\bDELETE\b/);
      expect(count).toContain("SELECT COUNT(*)::int AS rows FROM ranked WHERE rn > 1");
      // Same rows: everything up to the final clause is character for character
      // the statement the DELETE runs against.
      const ranked = (sql: string) => sql.slice(0, sql.indexOf("  )") + 3);
      expect(ranked(count)).toBe(ranked(remove));
    }
  });

  test("the device prune takes only devices silent since the cutoff, and is capped", () => {
    const remove = pruneDevicesSql("delete");
    expect(remove).toContain("DELETE FROM devices WHERE mac IN (");
    expect(remove).toContain("FROM device_readings r");
    expect(remove).toContain("r.recorded_at >= $1::timestamptz");
    expect(remove).toContain("NOT EXISTS");
    expect(remove).toContain("LIMIT $2");
  });

  test("the device prune dry run counts the same devices and removes none", () => {
    const count = pruneDevicesSql("count");
    expect(count).not.toMatch(/\bDELETE\b/);
    expect(count).toContain("SELECT COUNT(*)::int AS rows FROM (");
    const predicate = (sql: string) => sql.slice(sql.indexOf("SELECT d.mac"), sql.indexOf("LIMIT $2"));
    expect(predicate(count)).toBe(predicate(pruneDevicesSql("delete")));
  });
});

describe("thinning and the statistics page agree", () => {
  test("a gap between thinned survivors still counts as measured time", () => {
    // Survivors sit one hour apart, jittered by the push cadence. If the cut
    // were at the granularity itself, half those gaps would be read as outages
    // and avg_bytes_per_second would swing by up to a factor of two.
    expect(MAX_SAMPLE_GAP_SECONDS).toBeGreaterThan(THINNED_SAMPLE_GAP_SECONDS + 120);
  });
});
