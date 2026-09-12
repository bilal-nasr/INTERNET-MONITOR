import { describe, expect, test } from "vitest";
import type { CauseSegment } from "@/lib/outage-cause";
import {
  attachCauses,
  describeSplit,
  downtimeByDay,
  downtimeSplit,
  downtimeSplitByDay,
  downtimeWindowEnd,
  monitoringGaps,
  outagesFromSessions,
  type Outage,
  type StoredSilence,
} from "@/lib/outages";
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

  test("no sessions and nothing known before the range means no outages", () => {
    expect(outagesFromSessions([], range)).toEqual([]);
    expect(outagesFromSessions([session(1, "2026-09-10T00:00:00Z", null, 0)], range)).toEqual([]);
    expect(outagesFromSessions([session(1, "2026-09-10T00:00:00Z", null, null)], range)).toEqual([]);
  });

  test("a link already down when the range began is an outage, not silence", () => {
    // The morning after an overnight drop, on the default "today" range: the
    // last session ended yesterday so it is not listed, and no new one exists.
    // Reading that as "no outages" reports the link as healthy through the one
    // event the whole page is for.
    const previous = session(9, "2026-09-08T08:00:00Z", "2026-09-09T22:00:00Z");
    const outages = outagesFromSessions([], range, previous);
    expect(outages).toEqual<Outage[]>([
      {
        from: "2026-09-10T00:00:00.000Z", // clipped to the start of the range
        to: "2026-09-12T00:00:00.000Z",
        seconds: 172_800,
        ended_session_id: 9,
        next_session_id: null,
      },
    ]);
  });

  test("the fallback only speaks for a session that closed before the range", () => {
    // Still open: the link is up, or merely out of contact, which the page
    // reports as "no contact" rather than as downtime.
    expect(outagesFromSessions([], range, session(9, "2026-09-08T08:00:00Z", null))).toEqual([]);
    // Closed after the range started: it would have been listed, so its absence
    // says the range was asked about a time this session does not cover.
    expect(
      outagesFromSessions([], range, session(9, "2026-09-13T08:00:00Z", "2026-09-13T09:00:00Z")),
    ).toEqual([]);
    // An unbounded range has no start to have been down at.
    expect(
      outagesFromSessions([], { from: null, to: range.to }, session(9, "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z")),
    ).toEqual([]);
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

describe("downtimeWindowEnd", () => {
  const now = new Date("2026-09-11T14:50:00Z");

  test("stops at now when the range ends in the future", () => {
    // A custom range whose end is a bare date runs to the next local midnight,
    // which for today has not happened yet. Measuring downtime to it would
    // report a link that dropped minutes ago as down for the rest of the day.
    expect(downtimeWindowEnd(new Date("2026-09-11T21:00:00Z"), now)).toEqual(now);
  });

  test("leaves a range that has already ended alone", () => {
    const past = new Date("2026-09-10T00:00:00Z");
    expect(downtimeWindowEnd(past, now)).toEqual(past);
    expect(downtimeWindowEnd(now, now)).toEqual(now);
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

  test("splits across a midnight the local clock never strikes", () => {
    // Asia/Beirut springs forward at 00:00 on the last Sunday of March, so
    // 2027-03-28 00:00 does not exist and the first instant of that day is
    // 01:00 local (22:00Z). An outage from 22:00 on the 27th to 03:00 on the
    // 28th is four real hours, two on each side of that boundary. September
    // has no transition, so the test above never walks this path.
    const byDay = downtimeByDay(
      [
        {
          from: "2027-03-27T20:00:00.000Z", // 22:00 local, UTC+2
          to: "2027-03-28T00:00:00.000Z", // 03:00 local, UTC+3
          seconds: 14_400,
          ended_session_id: 1,
          next_session_id: 2,
        },
      ],
      "Asia/Beirut",
    );
    expect(byDay).toEqual([
      { day: "2027-03-27", seconds: 7_200, outages: 1 },
      { day: "2027-03-28", seconds: 7_200, outages: 1 },
    ]);
    // Every second of the outage is accounted for on some day, and the one
    // outage is counted once per day it touches.
    expect(byDay.reduce((sum, r) => sum + r.seconds, 0)).toBe(14_400);
  });

  test("no outages, no rows", () => {
    expect(downtimeByDay([], "UTC")).toEqual([]);
  });
});

function outage(from: string, to: string): Outage {
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    seconds: Math.round((Date.parse(to) - Date.parse(from)) / 1000),
    ended_session_id: 1,
    next_session_id: 2,
  };
}

function silence(from: string, to: string, segments: [string, string, CauseSegment["cause"]][]): StoredSilence {
  return {
    silence_from: new Date(from).toISOString(),
    silence_to: new Date(to).toISOString(),
    segments: segments.map(([f, t, cause]) => ({
      from: new Date(f).toISOString(),
      to: new Date(t).toISOString(),
      cause,
    })),
  };
}

const iso = (value: string) => new Date(value).toISOString();

describe("attachCauses", () => {
  test("clips the silence's segments to the outage", () => {
    const [withCauses] = attachCauses(
      [outage("2026-09-10T10:00:00Z", "2026-09-10T10:30:00Z")],
      [
        silence("2026-09-10T09:59:30Z", "2026-09-10T10:31:00Z", [
          ["2026-09-10T09:59:30Z", "2026-09-10T10:23:00Z", "router_off"],
          ["2026-09-10T10:23:00Z", "2026-09-10T10:31:00Z", "pppoe_down"],
        ]),
      ],
    );
    expect(withCauses.causes).toEqual<CauseSegment[]>([
      { from: iso("2026-09-10T10:00:00Z"), to: iso("2026-09-10T10:23:00Z"), cause: "router_off" },
      { from: iso("2026-09-10T10:23:00Z"), to: iso("2026-09-10T10:30:00Z"), cause: "pppoe_down" },
    ]);
    expect(withCauses.seconds).toBe(1800);
  });

  test("time no silence explains is unknown, so the causes always cover the outage", () => {
    const [withCauses] = attachCauses(
      [outage("2026-09-10T10:00:00Z", "2026-09-10T10:30:00Z")],
      [
        silence("2026-09-10T10:10:00Z", "2026-09-10T10:20:00Z", [
          ["2026-09-10T10:10:00Z", "2026-09-10T10:20:00Z", "no_internet"],
        ]),
      ],
    );
    expect(withCauses.causes.map((c) => c.cause)).toEqual(["unknown", "no_internet", "unknown"]);
    expect(withCauses.causes[0].to).toBe(iso("2026-09-10T10:10:00Z"));
    expect(withCauses.causes[2].from).toBe(iso("2026-09-10T10:20:00Z"));
  });

  test("an outage from before the feature is one unknown segment", () => {
    const [withCauses] = attachCauses([outage("2026-09-10T10:00:00Z", "2026-09-10T10:30:00Z")], []);
    expect(withCauses.causes).toEqual<CauseSegment[]>([
      { from: iso("2026-09-10T10:00:00Z"), to: iso("2026-09-10T10:30:00Z"), cause: "unknown" },
    ]);
  });
});

describe("monitoringGaps", () => {
  const outages = [outage("2026-09-10T10:00:00Z", "2026-09-10T10:30:00Z")];

  test("a silence that overlaps no outage is a monitoring gap", () => {
    const gap = silence("2026-09-10T12:00:00Z", "2026-09-10T12:03:00Z", [
      ["2026-09-10T12:00:00Z", "2026-09-10T12:03:00Z", "no_internet"],
    ]);
    expect(monitoringGaps([gap], outages)).toEqual([gap]);
  });

  test("a silence behind an outage is not", () => {
    const behind = silence("2026-09-10T09:59:30Z", "2026-09-10T10:31:00Z", [
      ["2026-09-10T09:59:30Z", "2026-09-10T10:31:00Z", "router_off"],
    ]);
    expect(monitoringGaps([behind], outages)).toEqual([]);
  });

  test("the app being unreachable is always a gap, never downtime", () => {
    const app = silence("2026-09-10T10:05:00Z", "2026-09-10T10:08:00Z", [
      ["2026-09-10T10:05:00Z", "2026-09-10T10:08:00Z", "app_unreachable"],
    ]);
    expect(monitoringGaps([app], outages)).toEqual([app]);
  });
});

describe("downtimeSplit", () => {
  test("adds up seconds by whose side each cause is on", () => {
    const outages = attachCauses(
      [outage("2026-09-10T10:00:00Z", "2026-09-10T10:30:00Z")],
      [
        silence("2026-09-10T10:00:00Z", "2026-09-10T10:25:00Z", [
          ["2026-09-10T10:00:00Z", "2026-09-10T10:20:00Z", "router_off"],
          ["2026-09-10T10:20:00Z", "2026-09-10T10:25:00Z", "no_internet"],
        ]),
      ],
    );
    expect(downtimeSplit(outages)).toEqual({ yours: 1200, isp: 300, neutral: 0, unknown: 300 });
  });
});

describe("downtimeSplitByDay", () => {
  test("slices each side at local midnight", () => {
    const outages = attachCauses(
      [outage("2026-09-10T23:50:00Z", "2026-09-11T00:20:00Z")],
      [
        silence("2026-09-10T23:50:00Z", "2026-09-11T00:20:00Z", [
          ["2026-09-10T23:50:00Z", "2026-09-11T00:05:00Z", "router_off"],
          ["2026-09-11T00:05:00Z", "2026-09-11T00:20:00Z", "no_internet"],
        ]),
      ],
    );
    const byDay = downtimeSplitByDay(outages, "UTC");
    expect(byDay.get("2026-09-10")).toEqual({ yours: 600, isp: 0, neutral: 0, unknown: 0 });
    expect(byDay.get("2026-09-11")).toEqual({ yours: 300, isp: 900, neutral: 0, unknown: 0 });
  });
});

describe("describeSplit", () => {
  const words = {
    splitYours: "your side {duration}",
    splitIsp: "ISP {duration}",
    splitNeutral: "scheduled {duration}",
    splitUnknown: "cause unknown {duration}",
  };
  const duration = (s: number) => `${s}s`;

  test("names each side that has time, in a fixed order", () => {
    expect(describeSplit({ yours: 600, isp: 300, neutral: 0, unknown: 60 }, words, duration)).toEqual([
      "your side 600s",
      "ISP 300s",
      "cause unknown 60s",
    ]);
  });

  test("says nothing when every second is unknown, so old ranges stay quiet", () => {
    expect(describeSplit({ yours: 0, isp: 0, neutral: 0, unknown: 900 }, words, duration)).toEqual([]);
  });
});
