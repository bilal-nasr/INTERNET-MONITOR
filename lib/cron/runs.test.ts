import { beforeEach, describe, expect, test, vi } from "vitest";
import { claimTick } from "@/lib/cron/runs";
import { db } from "@/lib/db";

/**
 * The lease is one SQL statement and nothing else, so there is no behaviour to
 * test here without a database - but the two properties the statement was
 * rewritten for are properties of its text, and those can be pinned honestly:
 *
 *  - it is skew-proof, meaning no instant produced by this process appears in
 *    it and both sides of the comparison are the database's own `now()`;
 *  - it is one round trip, meaning the bootstrap INSERT was folded into the
 *    claim rather than run before it.
 *
 * What the statement does once Postgres runs it is Postgres's contract, not
 * this module's, and is deliberately not claimed here.
 */
vi.mock("@/lib/db", () => ({
  db: { none: vi.fn(), one: vi.fn(), oneOrNone: vi.fn() },
}));

const oneOrNone = vi.mocked(db.oneOrNone);
const none = vi.mocked(db.none);

/** The SQL of the single query claimTick issued, whitespace normalised. */
function claimSql(): string {
  return String(oneOrNone.mock.calls[0][0]).replace(/\s+/g, " ").trim();
}

describe("claimTick", () => {
  beforeEach(() => {
    oneOrNone.mockReset().mockResolvedValue({ job: "tick" });
    none.mockReset().mockResolvedValue(null);
  });

  test("costs exactly one round trip", async () => {
    await claimTick();
    expect(oneOrNone).toHaveBeenCalledTimes(1);
    // The bootstrap INSERT used to run on every tick, for ever.
    expect(none).not.toHaveBeenCalled();
  });

  test("bootstraps and claims in the same statement", async () => {
    await claimTick();
    const sql = claimSql();
    expect(sql).toContain("INSERT INTO job_runs");
    expect(sql).toContain("ON CONFLICT (job) DO UPDATE");
    expect(sql).toContain("RETURNING job");
    expect(sql).not.toContain("DO NOTHING");
  });

  test("stamps and compares the lease with the database's clock, not the caller's", async () => {
    await claimTick();
    const sql = claimSql();
    expect(sql).toContain("SET last_run_at = now()");
    expect(sql).toContain("WHERE job_runs.last_run_at < now() -");

    // Nothing this process computed is sent: only the job name, the detail
    // string and the lease length. A Date among the values would be an instant
    // from this instance's clock, which is the skew the rewrite removed.
    const values = oneOrNone.mock.calls[0][1] as unknown[];
    expect(values.some((v) => v instanceof Date)).toBe(false);
    expect(values).toEqual(["tick", expect.any(String), expect.any(Number)]);
  });

  test("keeps the lease window it documents", async () => {
    await claimTick();
    const values = oneOrNone.mock.calls[0][1] as unknown[];
    // Comfortably longer than a tick, comfortably under the 60 s curl loop.
    expect(values[2]).toBe(30_000);
    expect(claimSql()).toContain("INTERVAL '1 millisecond'");
  });

  test("a claim that returns no row is a lease already held", async () => {
    oneOrNone.mockResolvedValue(null);
    expect(await claimTick()).toBe(false);

    oneOrNone.mockResolvedValue({ job: "tick" });
    expect(await claimTick()).toBe(true);
  });
});
