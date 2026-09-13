import { describe, expect, test } from "vitest";
import { reconnectedSince, type OpenSessionState, type SessionSample } from "@/lib/session-reconnect";

// The session opened by the first push after the 13 Sep power cut test, while
// the router's clock still read 12 Sep: its key is that wrong clock's link-up.
const open: OpenSessionState = {
  session_key: "2026-09-12 12:31:17",
  started_at: new Date("2026-09-13T08:15:12.623Z"),
  last_seen_at: new Date("2026-09-13T08:15:15.623Z"),
  last_tx_counter: 778,
  last_rx_counter: 684,
};

function sample(overrides: Partial<SessionSample> = {}): SessionSample {
  return {
    sessionKey: open.session_key,
    linkUpAt: new Date("2026-09-13T08:15:12.000Z"),
    txCounter: 213_368,
    rxCounter: 1_253_108,
    at: new Date("2026-09-13T08:15:44.876Z"),
    ...overrides,
  };
}

describe("reconnectedSince", () => {
  test("a key rewritten by the router's clock being set is the same link", () => {
    // /ip cloud corrected the clock: the key now reads 11:15:11 local, but after
    // the skew correction the link came up at the same instant as before.
    expect(
      reconnectedSince(open, sample({ sessionKey: "2026-09-13 11:15:11", linkUpAt: new Date("2026-09-13T08:15:11.000Z") })),
    ).toBe(false);
  });

  test("a new key with a later link-up is a reconnect", () => {
    expect(
      reconnectedSince(open, sample({ sessionKey: "2026-09-13 13:20:00", linkUpAt: new Date("2026-09-13T10:20:00.000Z"), at: new Date("2026-09-13T10:20:30.000Z") })),
    ).toBe(true);
  });

  test("counters going backwards are a reconnect even under the same key", () => {
    expect(reconnectedSince(open, sample({ txCounter: 10, rxCounter: 20 }))).toBe(true);
  });

  test("a new key with no usable link-up time is still read as a reconnect", () => {
    expect(reconnectedSince(open, sample({ sessionKey: "2026-09-13 11:15:11", linkUpAt: null }))).toBe(true);
  });

  test("a new key whose link-up lies in the future is not trusted to mean the same link", () => {
    expect(
      reconnectedSince(open, sample({ sessionKey: "2027-01-01 00:00:00", linkUpAt: new Date("2027-01-01T00:00:00.000Z") })),
    ).toBe(true);
  });

  test("a sample that is not newer than the last one is never a reconnect", () => {
    expect(
      reconnectedSince(open, sample({ sessionKey: "other", txCounter: 1, rxCounter: 1, at: open.last_seen_at })),
    ).toBe(false);
  });

  test("an ordinary sample on the same link is not a reconnect", () => {
    expect(reconnectedSince(open, sample())).toBe(false);
  });
});
