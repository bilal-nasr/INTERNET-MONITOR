import { describe, expect, test } from "vitest";
import { downtimeByDay, outagesFromSessions, type Outage } from "@/lib/outages";
import type { SessionSummary } from "@/lib/sessions";

function session(
  id: number,
  started: string,
  ended: string | null,
  downtimeBefore: number | null = null,
): SessionSummary {
  return {
    id,
    session_key: `s${id}`,
    interface_name: "pppoe-out1",
    started_at: new Date(started).toISOString(),
    ended_at: ended ? new Date(ended).toISOString() : null,
    end_reason: ended ? "reported" : null,
    last_seen_at: new Date(ended ?? started).toISOString(),
    open: ended === null,
    uptime_seconds: 0,
    seconds_since_seen: 0,
    downtime_before_seconds: downtimeBefore,
    tx_bytes: 0,
    rx_bytes: 0,
    total_bytes: 0,
    samples: 1,
  };
}

const range = { from: new Date("2026-09-10T00:00:00Z"), to: new Date("2026-09-12T00:00:00Z") };

describe("outagesFromSessions", () => {
  test("the gap between one session's end and the next one's start is an outage", () => {
    const outages = outagesFromSessions(
      [
        session(2, "2026-09-10T12:10:00Z", null),
        session(1, "2026-09-10T08:00:00Z", "2026-09-10T12:00:00Z"),
      ],
      range,
    );
    expect(outages).toEqual<Outage[]>([
      {
        from: "2026-09-10T12:00:00.000Z",
        to: "2026-09-10T12:10:00.000Z",
        seconds: 600,
        ended_session_id: 1,
        next_session_id: 2,
      },
    ]);
  });

  test("a closed newest session means the link is still down until the end of the range", () => {
    const outages = outagesFromSessions([session(1, "2026-09-11T08:00:00Z", "2026-09-11T20:00:00Z")], range);
    expect(outages).toEqual<Outage[]>([
      {
        from: "2026-09-11T20:00:00.000Z",
        to: "2026-09-12T00:00:00.000Z",
        seconds: 14_400,
        ended_session_id: 1,
        next_session_id: null,
      },
    ]);
  });

  test("the gap before the first listed session comes from its downtime_before_seconds", () => {
    const outages = outagesFromSessions([session(5, "2026-09-10T01:00:00Z", null, 7_200)], range);
    expect(outages).toEqual<Outage[]>([
      {
        from: "2026-09-10T00:00:00.000Z", // clipped: the gap began at 23:00 the day before
        to: "2026-09-10T01:00:00.000Z",
        seconds: 3_600,
        ended_session_id: null,
        next_session_id: 5,
      },
    ]);
  });

  test("outages are clipped to the range and dropped when nothing is left", () => {
    const outages = outagesFromSessions(
      [
        session(2, "2026-09-13T00:00:00Z", null), // starts after the range
        session(1, "2026-09-09T00:00:00Z", "2026-09-11T23:00:00Z"),
      ],
      range,
    );
    expect(outages).toEqual<Outage[]>([
      {
        from: "2026-09-11T23:00:00.000Z",
        to: "2026-09-12T00:00:00.000Z",
        seconds: 3_600,
        ended_session_id: 1,
        next_session_id: 2,
      },
    ]);
    // A gap entirely outside the range is not an outage of the range.
    expect(
      outagesFromSessions(
        [session(2, "2026-09-09T02:00:00Z", null), session(1, "2026-09-09T00:00:00Z", "2026-09-09T01:00:00Z")],
        range,
      ),
    ).toEqual([]);
  });

  test("no sessions, or one open session with no gap before it, means no outages", () => {
    expect(outagesFromSessions([], range)).toEqual([]);
    expect(outagesFromSessions([session(1, "2026-09-10T00:00:00Z", null, 0)], range)).toEqual([]);
    expect(outagesFromSessions([session(1, "2026-09-10T00:00:00Z", null, null)], range)).toEqual([]);
  });

  test("an open-ended range still works", () => {
    const outages = outagesFromSessions(
      [session(2, "2026-09-10T12:10:00Z", null), session(1, "2026-09-10T08:00:00Z", "2026-09-10T12:00:00Z")],
      { from: null, to: range.to },
    );
    expect(outages).toHaveLength(1);
    expect(outages[0].seconds).toBe(600);
  });
});

describe("downtimeByDay", () => {
  test("splits an outage across local midnight", () => {
    // 23:30 to 00:30 Beirut time (UTC+3 in September): 30 minutes on each day.
    const byDay = downtimeByDay(
      [
        {
          from: "2026-09-10T20:30:00.000Z",
          to: "2026-09-10T21:30:00.000Z",
          seconds: 3_600,
          ended_session_id: 1,
          next_session_id: 2,
        },
      ],
      "Asia/Beirut",
    );
    expect(byDay).toEqual([
      { day: "2026-09-10", seconds: 1_800, outages: 1 },
      { day: "2026-09-11", seconds: 1_800, outages: 1 },
    ]);
  });

  test("adds up several outages on one day and counts each once", () => {
    const outage = (from: string, to: string): Outage => ({
      from,
      to,
      seconds: (new Date(to).getTime() - new Date(from).getTime()) / 1000,
      ended_session_id: 1,
      next_session_id: 2,
    });
    const byDay = downtimeByDay(
      [outage("2026-09-10T08:00:00Z", "2026-09-10T08:05:00Z"), outage("2026-09-10T15:00:00Z", "2026-09-10T15:10:00Z")],
      "UTC",
    );
    expect(byDay).toEqual([{ day: "2026-09-10", seconds: 900, outages: 2 }]);
  });

  test("a multi-day outage touches every day it spans", () => {
    const byDay = downtimeByDay(
      [
        {
          from: "2026-09-10T12:00:00.000Z",
          to: "2026-09-12T06:00:00.000Z",
          seconds: 151_200,
          ended_session_id: 1,
          next_session_id: null,
        },
      ],
      "UTC",
    );
    expect(byDay).toEqual([
      { day: "2026-09-10", seconds: 43_200, outages: 1 },
      { day: "2026-09-11", seconds: 86_400, outages: 1 },
      { day: "2026-09-12", seconds: 21_600, outages: 1 },
    ]);
  });

  test("no outages, no rows", () => {
    expect(downtimeByDay([], "UTC")).toEqual([]);
  });
});
