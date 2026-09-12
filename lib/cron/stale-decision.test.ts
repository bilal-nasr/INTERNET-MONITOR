import { describe, expect, test } from "vitest";
import { FAILED_SEND_COOLDOWN_MS } from "@/lib/alerts/dispatch";
import { decideStaleAction, type StaleAlertRow } from "@/lib/cron/stale-decision";

const NOW = new Date("2026-09-14T12:00:00Z");
const RECENT = new Date("2026-09-14T11:58:00Z"); // 2 minutes ago
const OLD = new Date("2026-09-14T11:00:00Z"); // 60 minutes ago
const STALE_AFTER = 10; // minutes

function row(status: StaleAlertRow["status"], created_at: Date, payload: StaleAlertRow["payload"] = null): StaleAlertRow {
  return { status, created_at, payload };
}

describe("decideStaleAction", () => {
  test("stale_after_minutes 0 disables the check entirely, whatever else is true", () => {
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: 0,
        lastReadingAt: OLD,
        lastStale: null,
        lastRecovered: null,
      }),
    ).toBe("skip");
  });

  test("no reading ever, no alert history: not an outage, does nothing", () => {
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: null,
        lastStale: null,
        lastRecovered: null,
      }),
    ).toBe("skip");
  });

  test("recent reading, no alert history: nothing to do", () => {
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: RECENT,
        lastStale: null,
        lastRecovered: null,
      }),
    ).toBe("skip");
  });

  test("quiet and unreported: sends link_stale", () => {
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: OLD,
        lastStale: null,
        lastRecovered: null,
      }),
    ).toBe("send_stale");
  });

  test("quiet and already reported (sent, no reading since): does not resend", () => {
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: OLD,
        lastStale: row("sent", RECENT),
        lastRecovered: null,
      }),
    ).toBe("skip");
  });

  test("recovered after a reported outage: sends link_recovered exactly once", () => {
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: RECENT, // a fresh reading has arrived
        lastStale: row("sent", OLD, { last_reading_at: OLD.toISOString() }),
        lastRecovered: null,
      }),
    ).toBe("send_recovered");
  });

  test("already recovered: a second tick after link_recovered was sent does nothing", () => {
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: RECENT,
        lastStale: row("sent", OLD),
        lastRecovered: { created_at: RECENT },
      }),
    ).toBe("skip");
  });

  test("a fresh outage after a previous recovery is reported again", () => {
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: OLD, // silent again
        lastStale: row("sent", new Date("2026-09-14T09:00:00Z")),
        lastRecovered: { created_at: new Date("2026-09-14T09:05:00Z") },
      }),
    ).toBe("send_stale");
  });

  test("failed send, still within the cooldown: does not retry yet", () => {
    const failedAt = new Date(NOW.getTime() - (FAILED_SEND_COOLDOWN_MS - 1));
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: OLD,
        lastStale: row("failed", failedAt),
        lastRecovered: null,
      }),
    ).toBe("skip");
  });

  test("failed send, cooldown just expired: retries", () => {
    const failedAt = new Date(NOW.getTime() - FAILED_SEND_COOLDOWN_MS);
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: OLD,
        lastStale: row("failed", failedAt),
        lastRecovered: null,
      }),
    ).toBe("send_stale");
  });

  test("skipped send (no recipient configured): retries on the very next tick", () => {
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: OLD,
        lastStale: row("skipped", RECENT),
        lastRecovered: null,
      }),
    ).toBe("send_stale");
  });

  test("a failed row never triggers a recovery mail, even once readings resume", () => {
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: RECENT,
        lastStale: row("failed", OLD),
        lastRecovered: null,
      }),
    ).toBe("skip");
  });

  test("a skipped row never triggers a recovery mail, even once readings resume", () => {
    expect(
      decideStaleAction({
        now: NOW,
        staleAfterMinutes: STALE_AFTER,
        lastReadingAt: RECENT,
        lastStale: row("skipped", OLD),
        lastRecovered: null,
      }),
    ).toBe("skip");
  });
});
