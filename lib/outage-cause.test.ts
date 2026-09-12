import { describe, expect, test } from "vitest";
import {
  causeSide,
  classifySilence,
  dominantCause,
  isSilence,
  type CauseSegment,
  type RouterEvidence,
} from "@/lib/outage-cause";
import { evidenceBodySchema, evidenceFromBody } from "@/lib/outage-evidence";

// Every case is a half-hour silence, 10:00 to 10:30 UTC.
const FROM = new Date("2026-09-12T10:00:00.000Z");
const TO = new Date("2026-09-12T10:30:00.000Z");
const at = (second: number) => new Date(FROM.getTime() + second * 1000).toISOString();

const BEFORE_UPTIME = 100_000;
const AFTER_UPTIME = BEFORE_UPTIME + 1800;
/** The uptime quota-push read `second` seconds into the silence, on a router that stayed up. */
const mark = (second: number) => AFTER_UPTIME - (1800 - second);

function evidence(overrides: Partial<RouterEvidence> = {}): RouterEvidence {
  return {
    uptime_s: BEFORE_UPTIME,
    ether_running: true,
    ether_link_downs: 0,
    pppoe_running: true,
    pppoe_link_downs: 2,
    netwatch: "up",
    planned_reconnects: 1,
    push_failures: 0,
    eth_down_at: null,
    eth_up_at: null,
    ppp_down_at: null,
    ppp_up_at: null,
    net_down_at: null,
    net_up_at: null,
    ...overrides,
  };
}

function classify(after: Partial<RouterEvidence>, before: RouterEvidence | null = evidence()): CauseSegment[] {
  return classifySilence({ from: FROM, to: TO, before, after: evidence({ uptime_s: AFTER_UPTIME, ...after }) });
}

const whole = (cause: CauseSegment["cause"]): CauseSegment[] => [{ from: at(0), to: at(1800), cause }];

describe("classifySilence", () => {
  test("an old script that sends no uptime leaves the whole silence unknown", () => {
    expect(classify({ uptime_s: null })).toEqual(whole("unknown"));
  });

  test("uptime shorter than the silence is a power cut; startup is part of it", () => {
    // Booted at 10:27:30; PPPoE dialled within the 180 s grace.
    expect(classify({ uptime_s: 150, pppoe_link_downs: 0, planned_reconnects: 0, ppp_down_at: 35, ppp_up_at: 140 })).toEqual(
      whole("router_off"),
    );
  });

  test("after the startup grace, a link that stays down is labelled on its own", () => {
    // Booted at 10:20, grace ends 10:23, PPPoE only came up at 10:29:50.
    expect(
      classify({ uptime_s: 600, pppoe_link_downs: 0, planned_reconnects: 0, ppp_down_at: 35, ppp_up_at: 590 }),
    ).toEqual<CauseSegment[]>([
      { from: at(0), to: at(1380), cause: "router_off" },
      { from: at(1380), to: at(1800), cause: "pppoe_down" },
    ]);
  });

  test("the WAN port losing its link outranks everything it takes down with it", () => {
    expect(
      classify({
        ether_link_downs: 1,
        pppoe_link_downs: 3,
        eth_down_at: mark(30),
        eth_up_at: mark(1790),
        ppp_down_at: mark(31),
        ppp_up_at: mark(1795),
        net_down_at: mark(90),
      }),
    ).toEqual(whole("roof_link_down"));
  });

  test("netwatch down is no internet, even while the watchdog cycles PPPoE", () => {
    expect(
      classify({ pppoe_link_downs: 22, net_down_at: mark(80), ppp_down_at: mark(150), ppp_up_at: mark(1790) }),
    ).toEqual(whole("no_internet"));
  });

  test("PPPoE down with the port up and netwatch never down is the ISP dropping PPPoE", () => {
    expect(classify({ pppoe_link_downs: 3, ppp_down_at: mark(20), ppp_up_at: mark(1795) })).toEqual(whole("pppoe_down"));
  });

  test("a PPPoE drop matched by a planned reconnect is not blamed on the ISP", () => {
    expect(
      classify({ pppoe_link_downs: 3, planned_reconnects: 2, ppp_down_at: mark(20), ppp_up_at: mark(1795) }),
    ).toEqual(whole("scheduled_reconnect"));
  });

  test("a flap between two runs is caught by the link-down counter", () => {
    expect(classify({ pppoe_link_downs: 3 })).toEqual(whole("pppoe_down"));
  });

  test("everything up and only the pushes failing is the app being unreachable", () => {
    expect(classify({ push_failures: 60 })).toEqual(whole("app_unreachable"));
  });

  test("a mixed silence is split in time order", () => {
    expect(
      classify({ pppoe_link_downs: 3, ppp_down_at: mark(12), ppp_up_at: mark(600), net_down_at: mark(630) }),
    ).toEqual<CauseSegment[]>([
      { from: at(0), to: at(600), cause: "pppoe_down" },
      { from: at(600), to: at(630), cause: "unknown" },
      { from: at(630), to: at(1800), cause: "no_internet" },
    ]);
  });

  test("a link-down counter does not fill the lead before its own mark span (PPPoE)", () => {
    expect(classify({ pppoe_link_downs: 3, ppp_down_at: mark(1500), ppp_up_at: mark(1790) })).toEqual<CauseSegment[]>([
      { from: at(0), to: at(1500), cause: "unknown" },
      { from: at(1500), to: at(1800), cause: "pppoe_down" },
    ]);
  });

  test("a link-down counter does not fill the lead before its own mark span (ether)", () => {
    expect(
      classify({ ether_link_downs: 1, eth_down_at: mark(1500), eth_up_at: mark(1790) }),
    ).toEqual<CauseSegment[]>([
      { from: at(0), to: at(1500), cause: "unknown" },
      { from: at(1500), to: at(1800), cause: "roof_link_down" },
    ]);
  });

  test("an up mark that cannot be placed makes its own span unknown, not the layer's cause", () => {
    expect(classify({ net_down_at: mark(600), net_up_at: AFTER_UPTIME + 50 })).toEqual(whole("unknown"));
  });

  test("netwatch down with no marks and nothing else to go on is unknown, not app-unreachable", () => {
    expect(classify({ netwatch: "down" })).toEqual(whole("unknown"));
  });

  test("the WAN port reported down with no marks and nothing else to go on is unknown, not app-unreachable", () => {
    expect(classify({ ether_running: false })).toEqual(whole("unknown"));
  });

  test("a mark from before the silence is clamped to its start", () => {
    expect(classify({ net_down_at: mark(-300) })).toEqual(whole("no_internet"));
  });

  test("a mark later than the uptime itself makes the uncovered time unknown", () => {
    expect(classify({ net_down_at: AFTER_UPTIME + 50 })).toEqual(whole("unknown"));
  });

  test("uptime going backwards without a boot inside the silence is not trusted", () => {
    expect(classify({ uptime_s: BEFORE_UPTIME - 1000 })).toEqual(whole("unknown"));
  });

  test("with no earlier snapshot the marks still speak", () => {
    expect(classify({ ppp_down_at: mark(20), ppp_up_at: mark(1795) }, null)).toEqual(whole("pppoe_down"));
  });

  test("an empty or reversed silence has no segments", () => {
    expect(classifySilence({ from: TO, to: FROM, before: null, after: evidence() })).toEqual([]);
  });
});

describe("isSilence", () => {
  test("more than 90 seconds between pushes", () => {
    expect(isSilence(FROM, new Date(FROM.getTime() + 60_000))).toBe(false);
    expect(isSilence(FROM, new Date(FROM.getTime() + 90_000))).toBe(false);
    expect(isSilence(FROM, new Date(FROM.getTime() + 91_000))).toBe(true);
  });
});

describe("causeSide", () => {
  test("groups causes by whose problem they are", () => {
    expect(causeSide("router_off")).toBe("yours");
    expect(causeSide("roof_link_down")).toBe("yours");
    expect(causeSide("no_internet")).toBe("isp");
    expect(causeSide("pppoe_down")).toBe("isp");
    expect(causeSide("scheduled_reconnect")).toBe("neutral");
    expect(causeSide("app_unreachable")).toBe("neutral");
    expect(causeSide("unknown")).toBe("unknown");
  });
});

describe("dominantCause", () => {
  test("the longest segment wins; nothing is unknown", () => {
    expect(
      dominantCause([
        { from: at(0), to: at(60), cause: "pppoe_down" },
        { from: at(60), to: at(600), cause: "app_unreachable" },
      ]),
    ).toBe("app_unreachable");
    expect(dominantCause([])).toBe("unknown");
  });
});

describe("evidence from the push body", () => {
  test("RouterOS blanks become missing values, and a malformed field never fails the push", () => {
    const body = evidenceBodySchema.parse({
      uptime_s: "108448",
      ether_running: "true",
      ether_link_downs: "",
      netwatch: "doing-test",
      eth_down_at: "",
      ppp_down_at: "12.5",
    });
    expect(body.uptime_s).toBe(108448);
    expect(body.ether_running).toBe(true);
    expect(body.ether_link_downs).toBeUndefined();
    expect(body.netwatch).toBe("unknown");
    expect(body.eth_down_at).toBeUndefined();
    expect(body.ppp_down_at).toBeUndefined();
  });

  test("a non-digit string or a non-numeric type never coerces to 0", () => {
    const body = evidenceBodySchema.parse({ ether_link_downs: " ", uptime_s: false });
    expect(body.ether_link_downs).toBeUndefined();
    expect(body.uptime_s).toBeUndefined();
  });

  test("fields an old script does not send become null; PPPoE state comes from the push", () => {
    expect(evidenceFromBody(evidenceBodySchema.parse({}), true)).toEqual<RouterEvidence>({
      uptime_s: null,
      ether_running: null,
      ether_link_downs: null,
      pppoe_running: true,
      pppoe_link_downs: null,
      netwatch: "unknown",
      planned_reconnects: null,
      push_failures: null,
      eth_down_at: null,
      eth_up_at: null,
      ppp_down_at: null,
      ppp_up_at: null,
      net_down_at: null,
      net_up_at: null,
    });
  });
});
