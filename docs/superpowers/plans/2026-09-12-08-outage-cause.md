# Outage Cause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Label every outage as the owner's side (router off, roof link down) or the ISP's (PPPoE dropped, no internet), from evidence the router sends with the push that ends a silence.

**Architecture:** `quota-push` keeps uptime-second marks of when the WAN port, the PPPoE link and the netwatch probe went down and came back, and sends them with every push. The ingest route stores the latest snapshot in `router_status`. When a push arrives more than 90 s after the previous one, a pure function (`lib/outage-cause.ts`) turns the before and after snapshots into ordered cause segments, stored in `outage_causes`. The sessions page attaches those segments to the outages it already derives from sessions: labels in the table, a your-side/ISP split in the summary and calendar, and a separate list of monitoring gaps. The "router is back" mail names the cause.

**Tech Stack:** Next.js 16 App Router, pg-promise, zod 4, vitest, RouterOS 7.24 scripting.

**Spec:** `docs/superpowers/specs/2026-09-12-outage-cause-design.md`

## Global Constraints

- **No task commits.** The owner commits manually. Every task ends when `pnpm test`, `pnpm lint` and `pnpm exec tsc --noEmit` all pass. Then stop.
- **Never change the router or the production database without the owner's OK at that moment.** That covers SSH configuration commands, pasting scripts, disabling interfaces and running `schema.sql`. Read-only router commands are fine.
- Unit tests are vitest, `lib/**/*.test.ts`, pure, with no database.
- Every user-visible string goes into both `lib/i18n/dictionaries/en.ts` and `lib/i18n/dictionaries/ar.ts`. `lib/i18n.test.ts` fails on a missing Arabic key, or on an Arabic value that is still English.
- Next.js 16: read `node_modules/next/dist/docs/` before changing a page or route. This plan adds no new routes.
- `router/quota-push.rsc` (after its dashed marker line) and `QUOTA_PUSH_TEMPLATE` in `lib/router/script-template.ts` must stay identical. `lib/router/script.test.ts` enforces it. Inside the template literal, every backslash in the RouterOS text is doubled.
- Schema changes are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), added to `schema.sql`.
- Constants, copied from the spec:
  - silence threshold: 90 s
  - startup grace after a reboot: 180 s
  - leading-edge snap: 95 s
  - trailing-edge snap: 35 s
  - boot slack: 5 s
  - netwatch entry name: `internet-probe`
- Router facts verified on 2026-09-12 (hEX lite, RouterOS 7.24.2):
  - `:tonum [/system resource get uptime]` gives whole seconds.
  - `/interface pppoe-client get [find name=pppoe-out1] interface` gives `ISP-ether1`.
  - `link-downs` is a num.
  - netwatch `status` is `up`/`down`.
  - Globals set by the scheduler's script can be read from other contexts.

---

## File map

| File | Responsibility | Task |
| --- | --- | --- |
| `lib/outage-cause.ts` (+ test) | pure, no zod (client components import it): evidence types, `classifySilence`, `causeSide`, segment helpers | 1 |
| `lib/outage-evidence.ts` (tested in `lib/outage-cause.test.ts`) | zod fields for the push body, `evidenceFromBody`; server only | 1 |
| `lib/outages.ts` (+ test) | pure: `attachCauses`, `monitoringGaps`, `downtimeSplit`, `downtimeSplitByDay`, `describeSplit` | 2 |
| `schema.sql` | `router_status`, `outage_causes` | 3 |
| `lib/outage-cause-store.ts` | `recordRouterEvidence`, `getSilences`, `findSilenceStartingAt` | 3 |
| `app/api/ingest/route.ts` | accept the fields, record the evidence | 3 |
| `router/quota-push.rsc`, `lib/router/script-template.ts`, `router/pppoe-reconnect.rsc`, `router/internet-watchdog.md`, `README.md` | router evidence and its documentation | 4 |
| `components/CauseChips.tsx`, `components/MonitoringGaps.tsx`, `components/SessionsTable.tsx`, `components/OutageSummary.tsx`, `components/OutageCalendar.tsx`, `components/StatusCard.tsx`, `app/[lang]/(app)/sessions/page.tsx`, dictionaries | what the owner sees | 5 |
| `lib/email-link-template.ts` (+ test), `lib/cron/stale.ts`, dictionaries | cause in the "router is back" mail | 6 |
| none (owner-gated) | schema, deploy, router install, hardware checks | 7 |

---

### Task 1: The cause rules

**Files:**
- Create: `lib/outage-cause.ts`
- Create: `lib/outage-evidence.ts`
- Test: `lib/outage-cause.test.ts`

`lib/outage-cause.ts` must not import zod. `components/CauseChips.tsx` (Task 5) is a client component that imports it, and zod is in no client bundle today. The zod schema therefore lives in `lib/outage-evidence.ts`, which only the ingest route imports.

**Interfaces:**
- Produces, all exported from `lib/outage-cause.ts`:
  - `type OutageCause = "router_off" | "roof_link_down" | "no_internet" | "scheduled_reconnect" | "pppoe_down" | "app_unreachable" | "unknown"`
  - `type CauseSide = "yours" | "isp" | "neutral" | "unknown"`
  - `const CAUSE_SIDES: readonly CauseSide[]`
  - `function causeSide(cause: OutageCause): CauseSide`
  - `interface CauseSegment { from: string; to: string; cause: OutageCause }` (ISO instants)
  - `function segmentSeconds(segment: CauseSegment): number`
  - `function appendSegment(out: CauseSegment[], fromMs: number, toMs: number, cause: OutageCause): void` (merges with a touching segment of the same cause, ignores empty spans)
  - `function dominantCause(segments: CauseSegment[]): OutageCause`
  - `type NetwatchStatus = "up" | "down" | "unknown"`
  - `interface RouterEvidence` (fields below)
  - `const SILENCE_SECONDS = 90`
  - `function isSilence(previousAt: Date, at: Date): boolean`
  - `interface SilenceInput { from: Date; to: Date; before: RouterEvidence | null; after: RouterEvidence }`
  - `function classifySilence(input: SilenceInput): CauseSegment[]`
- Produces, all exported from `lib/outage-evidence.ts`:
  - `const evidenceBodyFields` (zod shape to spread into the ingest body schema)
  - `const evidenceBodySchema`
  - `type EvidenceBody`
  - `function evidenceFromBody(body: EvidenceBody, pppoeRunning: boolean): RouterEvidence`

- [ ] **Step 1: Write the failing test**

Create `lib/outage-cause.test.ts`:

```ts
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
      { from: at(0), to: at(630), cause: "pppoe_down" },
      { from: at(630), to: at(1800), cause: "no_internet" },
    ]);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/outage-cause.test.ts`
Expected: FAIL, because `@/lib/outage-cause` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `lib/outage-cause.ts`:

```ts
/**
 * Why the router went quiet: the router's own account of a silence, turned
 * into ordered cause segments.
 *
 * The router reports over the connection that fails, so nothing is known while
 * a silence lasts. The push that ends it carries what quota-push saw in the
 * meantime, recorded in uptime seconds: uptime is the one clock that is right
 * after a power cut, because the hEX lite has no battery clock and only gets
 * the time from /ip cloud once it is back online.
 *
 * Pure: no database, no clock, and no zod, because client components import
 * it; the push body's schema is in lib/outage-evidence.ts. The rules are in
 * docs/superpowers/specs/2026-09-12-outage-cause-design.md.
 */

export type OutageCause =
  | "router_off"
  | "roof_link_down"
  | "no_internet"
  | "scheduled_reconnect"
  | "pppoe_down"
  | "app_unreachable"
  | "unknown";

export type CauseSide = "yours" | "isp" | "neutral" | "unknown";

export const CAUSE_SIDES: readonly CauseSide[] = ["yours", "isp", "neutral", "unknown"];

export function causeSide(cause: OutageCause): CauseSide {
  switch (cause) {
    case "router_off":
    case "roof_link_down":
      return "yours";
    case "no_internet":
    case "pppoe_down":
      return "isp";
    case "scheduled_reconnect":
    case "app_unreachable":
      return "neutral";
    default:
      return "unknown";
  }
}

export interface CauseSegment {
  /** ISO instant. */
  from: string;
  /** ISO instant. */
  to: string;
  cause: OutageCause;
}

export function segmentSeconds(segment: CauseSegment): number {
  return Math.round((Date.parse(segment.to) - Date.parse(segment.from)) / 1000);
}

/** Add a span to an ordered list, extending the last segment when it has the same cause and touches. */
export function appendSegment(out: CauseSegment[], fromMs: number, toMs: number, cause: OutageCause): void {
  if (toMs <= fromMs) return;
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  const last = out[out.length - 1];
  if (last && last.cause === cause && last.to === from) {
    last.to = to;
    return;
  }
  out.push({ from, to, cause });
}

/** The cause that took up the most time; "unknown" when there is none. */
export function dominantCause(segments: CauseSegment[]): OutageCause {
  let best: CauseSegment | null = null;
  for (const segment of segments) {
    if (!best || segmentSeconds(segment) > segmentSeconds(best)) best = segment;
  }
  return best?.cause ?? "unknown";
}

export type NetwatchStatus = "up" | "down" | "unknown";

/** What one push says about the router. Null means the script did not send it. */
export interface RouterEvidence {
  uptime_s: number | null;
  ether_running: boolean | null;
  ether_link_downs: number | null;
  pppoe_running: boolean;
  pppoe_link_downs: number | null;
  netwatch: NetwatchStatus;
  /** How often pppoe-reconnect has run since boot. */
  planned_reconnects: number | null;
  push_failures: number | null;
  /** Uptime seconds of the first run that found the WAN port down, and of the run that found it back. */
  eth_down_at: number | null;
  eth_up_at: number | null;
  ppp_down_at: number | null;
  ppp_up_at: number | null;
  net_down_at: number | null;
  net_up_at: number | null;
}

/** Three missed 30-second pushes. */
export const SILENCE_SECONDS = 90;

export function isSilence(previousAt: Date, at: Date): boolean {
  return at.getTime() - previousAt.getTime() > SILENCE_SECONDS * 1000;
}

/** Uptime is read a moment before the push lands; a boot this close to the last push is not one. */
const BOOT_SLACK_MS = 5_000;
/** After a reboot the router, the roof switch and the PPPoE dial all take time. */
const STARTUP_MS = 180_000;
/**
 * Pushes fail the moment a link goes, but the mark lags: netwatch needs up to
 * about 63 s to declare down and quota-push samples every 30 s.
 */
const LEAD_SNAP_MS = 95_000;
/** The run that finds a link back is normally the run whose push ends the silence. */
const TAIL_SNAP_MS = 35_000;

export interface SilenceInput {
  /** Server time of the last push before the silence. */
  from: Date;
  /** Server time of the push that ended it. */
  to: Date;
  /** The router's report in that last push; null when none was stored. */
  before: RouterEvidence | null;
  after: RouterEvidence;
}

interface Span {
  from: number;
  to: number;
}

export function classifySilence({ from, to, before, after }: SilenceInput): CauseSegment[] {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const out: CauseSegment[] = [];
  if (!(toMs > fromMs)) return out;

  const uptime = after.uptime_s;
  if (uptime === null) {
    appendSegment(out, fromMs, toMs, "unknown");
    return out;
  }

  const bootMs = toMs - uptime * 1000;
  const rebooted = bootMs > fromMs + BOOT_SLACK_MS;
  // Lower uptime than last time, yet no boot inside the silence: the report
  // contradicts itself, so none of it is used.
  if (!rebooted && before?.uptime_s != null && uptime < before.uptime_s) {
    appendSegment(out, fromMs, toMs, "unknown");
    return out;
  }

  // Before a boot nothing survives: the marks lived in globals that died with
  // the power. The evidence only describes the time since boot.
  const windowFrom = rebooted ? bootMs : fromMs;
  const startupEnd = rebooted ? Math.min(windowFrom + STARTUP_MS, toMs) : windowFrom;
  let suspect = false;

  const instant = (mark: number | null): number | null => {
    if (mark === null) return null;
    if (mark > uptime) {
      suspect = true;
      return null;
    }
    const ms = toMs - (uptime - mark) * 1000;
    return Math.min(Math.max(ms, windowFrom), toMs);
  };

  const span = (downAt: number | null, upAt: number | null): Span | null => {
    const down = instant(downAt);
    if (down === null) return null;
    const up = instant(upAt) ?? toMs;
    const start = down - windowFrom <= LEAD_SNAP_MS ? windowFrom : down;
    const end = toMs - up <= TAIL_SNAP_MS ? toMs : up;
    return end > start ? { from: start, to: end } : null;
  };

  // Counters restart at boot, so they only compare across a router that stayed up.
  const rose = (now: number | null, then: number | null | undefined): boolean =>
    !rebooted && now !== null && then != null && now > then;
  const planned =
    after.planned_reconnects !== null &&
    (rebooted ? after.planned_reconnects > 0 : rose(after.planned_reconnects, before?.planned_reconnects));
  const pppoeCause: OutageCause = planned ? "scheduled_reconnect" : "pppoe_down";

  // Highest precedence first. Netwatch outranks PPPoE because the watchdog
  // cycles PPPoE whenever netwatch is down; the port outranks both because
  // nothing passes a dead port.
  const layers: { span: Span | null; cause: OutageCause }[] = [
    { span: span(after.eth_down_at, after.eth_up_at), cause: "roof_link_down" },
    { span: span(after.net_down_at, after.net_up_at), cause: "no_internet" },
    { span: span(after.ppp_down_at, after.ppp_up_at), cause: pppoeCause },
  ];

  // Time no mark covers.
  const fallback: OutageCause = suspect
    ? "unknown"
    : rose(after.ether_link_downs, before?.ether_link_downs)
      ? "roof_link_down"
      : rose(after.pppoe_link_downs, before?.pppoe_link_downs)
        ? pppoeCause
        : after.netwatch !== "unknown" && after.ether_running !== null
          ? "app_unreachable"
          : "unknown";

  if (rebooted) appendSegment(out, fromMs, windowFrom, "router_off");

  const cuts = new Set<number>([windowFrom, startupEnd, toMs]);
  for (const layer of layers) {
    if (layer.span) {
      cuts.add(layer.span.from);
      cuts.add(layer.span.to);
    }
  }
  const points = [...cuts].sort((a, b) => a - b);
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (rebooted && end <= startupEnd) {
      appendSegment(out, start, end, "router_off");
      continue;
    }
    const hit = layers.find((layer) => layer.span !== null && layer.span.from <= start && end <= layer.span.to);
    appendSegment(out, start, end, hit ? hit.cause : fallback);
  }
  return out;
}
```

Create `lib/outage-evidence.ts`:

```ts
import { z } from "zod";
import type { RouterEvidence } from "@/lib/outage-cause";

/**
 * The outage evidence fields of the router's push, as zod sees them. Kept apart
 * from lib/outage-cause.ts so the client components that label outages do not
 * pull zod into the browser bundle.
 */

/** RouterOS sends an unset global as an empty string. */
const blank = (value: unknown) => (value === "" || value === null ? undefined : value);

// Every field falls back instead of failing: the reading in the same push is
// the one fact that cannot be rebuilt, and a malformed diagnostic must never
// cost it a 400.
const seconds = z
  .preprocess(blank, z.coerce.number().int().nonnegative().max(1e10).optional())
  .catch(undefined);
const flag = z
  .preprocess(blank, z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]).optional())
  .catch(undefined);

/** Spread into the ingest body schema. All optional: an old script sends none of them. */
export const evidenceBodyFields = {
  uptime_s: seconds,
  ether_running: flag,
  ether_link_downs: seconds,
  pppoe_link_downs: seconds,
  netwatch: z.preprocess(blank, z.enum(["up", "down", "unknown"]).optional()).catch("unknown"),
  planned_reconnects: seconds,
  push_failures: seconds,
  eth_down_at: seconds,
  eth_up_at: seconds,
  ppp_down_at: seconds,
  ppp_up_at: seconds,
  net_down_at: seconds,
  net_up_at: seconds,
};

export const evidenceBodySchema = z.object(evidenceBodyFields);

export type EvidenceBody = z.infer<typeof evidenceBodySchema>;

export function evidenceFromBody(body: EvidenceBody, pppoeRunning: boolean): RouterEvidence {
  return {
    uptime_s: body.uptime_s ?? null,
    ether_running: body.ether_running ?? null,
    ether_link_downs: body.ether_link_downs ?? null,
    pppoe_running: pppoeRunning,
    pppoe_link_downs: body.pppoe_link_downs ?? null,
    netwatch: body.netwatch ?? "unknown",
    planned_reconnects: body.planned_reconnects ?? null,
    push_failures: body.push_failures ?? null,
    eth_down_at: body.eth_down_at ?? null,
    eth_up_at: body.eth_up_at ?? null,
    ppp_down_at: body.ppp_down_at ?? null,
    ppp_up_at: body.ppp_up_at ?? null,
    net_down_at: body.net_down_at ?? null,
    net_up_at: body.net_up_at ?? null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test lib/outage-cause.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Run the full checks**

Run: `pnpm test; pnpm lint; pnpm exec tsc --noEmit`
Expected: all pass. Stop here; the owner commits.

---

### Task 2: Attaching causes to outages

**Files:**
- Modify: `lib/outages.ts`
- Test: `lib/outages.test.ts`

**Interfaces:**
- Consumes (Task 1): `appendSegment`, `causeSide`, `CAUSE_SIDES`, `CauseSegment`, `CauseSide`
- Produces, all exported from `lib/outages.ts`:
  - `interface StoredSilence { silence_from: string; silence_to: string; segments: CauseSegment[] }`
  - `interface OutageWithCauses extends Outage { causes: CauseSegment[] }`
  - `function attachCauses(outages: Outage[], silences: StoredSilence[]): OutageWithCauses[]`
  - `function monitoringGaps(silences: StoredSilence[], outages: Outage[]): StoredSilence[]`
  - `type DowntimeSplit = Record<CauseSide, number>`
  - `function downtimeSplit(outages: OutageWithCauses[]): DowntimeSplit`
  - `function downtimeSplitByDay(outages: OutageWithCauses[], timezone: string): Map<string, DowntimeSplit>`
  - `interface SplitWords { splitYours: string; splitIsp: string; splitNeutral: string; splitUnknown: string }`
  - `function describeSplit(split: DowntimeSplit, words: SplitWords, duration: (seconds: number) => string): string[]`

- [ ] **Step 1: Write the failing tests**

In `lib/outages.test.ts`, replace the import block at the top with:

```ts
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
```

Append at the end of the file:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test lib/outages.test.ts`
Expected: FAIL, because `attachCauses` (and the other new names) are not exported.

- [ ] **Step 3: Write the implementation**

In `lib/outages.ts`, replace the first two lines:

```ts
import type { SessionSummary } from "@/lib/sessions";
import { localParts, localTimeInstant } from "@/lib/time";
```

with:

```ts
import { fill } from "@/lib/i18n";
import { appendSegment, CAUSE_SIDES, causeSide, type CauseSegment, type CauseSide } from "@/lib/outage-cause";
import type { SessionSummary } from "@/lib/sessions";
import { localParts, localTimeInstant } from "@/lib/time";
```

Append at the end of `lib/outages.ts`:

```ts
/** A silence as stored in outage_causes, trimmed to what the pages show. */
export interface StoredSilence {
  silence_from: string;
  silence_to: string;
  segments: CauseSegment[];
}

export interface OutageWithCauses extends Outage {
  /** Ordered, touching and covering the outage exactly; "unknown" where the router said nothing. */
  causes: CauseSegment[];
}

/**
 * Give each outage the causes the router reported for the time it covers.
 *
 * The outage itself is left as it is: its span and its seconds come from the
 * sessions, which is what the downtime totals are measured from, so labelling
 * an outage never changes how long it was.
 */
export function attachCauses(outages: Outage[], silences: StoredSilence[]): OutageWithCauses[] {
  const segments = silences
    .flatMap((silence) => silence.segments)
    .sort((a, b) => Date.parse(a.from) - Date.parse(b.from));

  return outages.map((outage) => {
    const lo = Date.parse(outage.from);
    const hi = Date.parse(outage.to);
    const causes: CauseSegment[] = [];
    let cursor = lo;
    for (const segment of segments) {
      const start = Math.max(Date.parse(segment.from), cursor);
      const end = Math.min(Date.parse(segment.to), hi);
      if (end <= start) continue;
      appendSegment(causes, cursor, start, "unknown");
      appendSegment(causes, start, end, segment.cause);
      cursor = end;
    }
    appendSegment(causes, cursor, hi, "unknown");
    return { ...outage, causes };
  });
}

/**
 * Silences that are not downtime: the router went quiet but no session outage
 * lies behind it (a short blip where PPPoE never dropped), or the only thing
 * wrong was reaching the app.
 */
export function monitoringGaps(silences: StoredSilence[], outages: Outage[]): StoredSilence[] {
  return silences.filter((silence) => {
    const lo = Date.parse(silence.silence_from);
    const hi = Date.parse(silence.silence_to);
    const overlaps = outages.some((o) => Date.parse(o.from) < hi && lo < Date.parse(o.to));
    return !overlaps || silence.segments.every((segment) => segment.cause === "app_unreachable");
  });
}

export type DowntimeSplit = Record<CauseSide, number>;

function emptySplit(): DowntimeSplit {
  return { yours: 0, isp: 0, neutral: 0, unknown: 0 };
}

/**
 * Seconds of downtime by side, over the outages listed. Bounded by the same row
 * limit as the list, so on a very long range it can fall short of the total
 * counted in the database; it is shown as a hint beside that total, not as one.
 */
export function downtimeSplit(outages: OutageWithCauses[]): DowntimeSplit {
  const split = emptySplit();
  for (const outage of outages) {
    for (const segment of outage.causes) {
      split[causeSide(segment.cause)] += Math.round((Date.parse(segment.to) - Date.parse(segment.from)) / 1000);
    }
  }
  return split;
}

/** The same split for each local day, sliced at midnight the way downtimeByDay slices outages. */
export function downtimeSplitByDay(outages: OutageWithCauses[], timezone: string): Map<string, DowntimeSplit> {
  const byDay = new Map<string, DowntimeSplit>();
  for (const side of CAUSE_SIDES) {
    const spans: Outage[] = outages.flatMap((outage) =>
      outage.causes
        .filter((segment) => causeSide(segment.cause) === side)
        .map((segment) => ({
          from: segment.from,
          to: segment.to,
          seconds: 0,
          ended_session_id: null,
          next_session_id: null,
        })),
    );
    for (const row of downtimeByDay(spans, timezone)) {
      const split = byDay.get(row.day) ?? emptySplit();
      split[side] += row.seconds;
      byDay.set(row.day, split);
    }
  }
  return byDay;
}

export interface SplitWords {
  splitYours: string;
  splitIsp: string;
  splitNeutral: string;
  splitUnknown: string;
}

/**
 * The split as short phrases, each side with time, in a fixed order. Nothing
 * when no second has a known cause: a range from before the router sent
 * evidence would otherwise say "cause unknown" beside every figure.
 */
export function describeSplit(
  split: DowntimeSplit,
  words: SplitWords,
  duration: (seconds: number) => string,
): string[] {
  if (split.yours + split.isp + split.neutral === 0) return [];
  const parts: [number, string][] = [
    [split.yours, words.splitYours],
    [split.isp, words.splitIsp],
    [split.neutral, words.splitNeutral],
    [split.unknown, words.splitUnknown],
  ];
  return parts.filter(([seconds]) => seconds > 0).map(([seconds, text]) => fill(text, { duration: duration(seconds) }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test lib/outages.test.ts`
Expected: PASS. The existing `outagesFromSessions`, `downtimeByDay` and `downtimeWindowEnd` tests still pass too.

- [ ] **Step 5: Run the full checks**

Run: `pnpm test; pnpm lint; pnpm exec tsc --noEmit`
Expected: all pass. Stop here; the owner commits.

---

### Task 3: Storing the evidence on every push

**Files:**
- Modify: `schema.sql` (tables at the end of the migrations section, just before the `DO $$` block; one index in the indexes section)
- Create: `lib/outage-cause-store.ts`
- Modify: `app/api/ingest/route.ts`

**Interfaces:**
- Consumes (Task 1): `evidenceBodyFields`, `evidenceFromBody`, `classifySilence`, `isSilence`, `RouterEvidence`, `CauseSegment`
- Consumes (Task 2, type only): `StoredSilence` from `lib/outages.ts`
- Produces, all exported from `lib/outage-cause-store.ts`:
  - `recordRouterEvidence(evidence: RouterEvidence, at: Date): Promise<"skipped" | "none" | "classified" | "failed">`
  - `getSilences(window: SessionWindow): Promise<StoredSilence[]>`
  - `findSilenceStartingAt(at: Date): Promise<StoredSilence | null>`

- [ ] **Step 1: Add the tables**

In `schema.sql`, insert immediately before the line `-- CHECK constraints have no IF NOT EXISTS, so add them only when missing.`:

```sql
-- Outage causes (docs/superpowers/specs/2026-09-12-outage-cause-design.md).
-- The router's last report, one row, so the push that ends a silence has
-- something to compare with.
CREATE TABLE IF NOT EXISTS router_status (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  recorded_at  TIMESTAMPTZ NOT NULL,
  evidence     JSONB NOT NULL
);

-- One row per silence longer than 90 seconds: the cause segments and the two
-- raw reports they were derived from, so the rules can be re-run. Unique on
-- silence_from: two pushes ending the same silence write it once. Never thinned.
CREATE TABLE IF NOT EXISTS outage_causes (
  id               SERIAL PRIMARY KEY,
  silence_from     TIMESTAMPTZ NOT NULL UNIQUE,
  silence_to       TIMESTAMPTZ NOT NULL,
  segments         JSONB NOT NULL,
  evidence_before  JSONB,
  evidence_after   JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

```

In the indexes section, after `CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON sessions (started_at DESC);`, add:

```sql
CREATE INDEX IF NOT EXISTS outage_causes_silence_to_idx ON outage_causes (silence_to);
```

- [ ] **Step 2: Write the store**

Create `lib/outage-cause-store.ts`:

```ts
import { db } from "@/lib/db";
import { classifySilence, isSilence, type CauseSegment, type RouterEvidence } from "@/lib/outage-cause";
import type { StoredSilence } from "@/lib/outages";
import type { SessionWindow } from "@/lib/sessions";

/**
 * The database side of outage causes: keep the router's last report, and when a
 * push ends a silence, store what the router says happened during it.
 */

interface SilenceRow {
  silence_from: Date;
  silence_to: Date;
  segments: CauseSegment[];
}

function toStored(row: SilenceRow): StoredSilence {
  return {
    silence_from: row.silence_from.toISOString(),
    silence_to: row.silence_to.toISOString(),
    segments: row.segments,
  };
}

/**
 * Called by /api/ingest after the reading is stored. Never throws: the push has
 * already done the part that matters, and a failure here only costs a label.
 */
export async function recordRouterEvidence(
  evidence: RouterEvidence,
  at: Date,
): Promise<"skipped" | "none" | "classified" | "failed"> {
  // An old script sends no uptime: there is nothing to keep or compare.
  if (evidence.uptime_s === null) return "skipped";
  try {
    const previous = await db.oneOrNone<{ recorded_at: Date; evidence: RouterEvidence }>(
      "SELECT recorded_at, evidence FROM router_status WHERE id = 1",
    );

    let outcome: "none" | "classified" = "none";
    if (previous && isSilence(previous.recorded_at, at)) {
      const segments = classifySilence({ from: previous.recorded_at, to: at, before: previous.evidence, after: evidence });
      await db.none(
        `INSERT INTO outage_causes (silence_from, silence_to, segments, evidence_before, evidence_after)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
         ON CONFLICT (silence_from) DO NOTHING`,
        [previous.recorded_at, at, JSON.stringify(segments), JSON.stringify(previous.evidence), JSON.stringify(evidence)],
      );
      outcome = "classified";
    }

    // Only ever forwards: a retried or overtaken push must not replace a newer report.
    await db.none(
      `INSERT INTO router_status (id, recorded_at, evidence) VALUES (1, $1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET recorded_at = EXCLUDED.recorded_at, evidence = EXCLUDED.evidence
       WHERE router_status.recorded_at < EXCLUDED.recorded_at`,
      [at, JSON.stringify(evidence)],
    );
    return outcome;
  } catch (err) {
    console.warn("[ingest] could not record outage evidence", err);
    return "failed";
  }
}

/** Silences overlapping the window, oldest first. */
export async function getSilences({ from, to }: SessionWindow): Promise<StoredSilence[]> {
  const rows = await db.any<SilenceRow>(
    `SELECT silence_from, silence_to, segments FROM outage_causes
     WHERE silence_to >= COALESCE($1::timestamptz, '-infinity'::timestamptz)
       AND silence_from < $2::timestamptz
     ORDER BY silence_from`,
    [from, to],
  );
  return rows.map(toStored);
}

/**
 * The silence that began with the reading at `at`. The stale job knows that
 * reading's time from its complaint; the silence starts at the same push, so the
 * few seconds of slack only absorb rounding.
 */
export async function findSilenceStartingAt(at: Date): Promise<StoredSilence | null> {
  const row = await db.oneOrNone<SilenceRow>(
    `SELECT silence_from, silence_to, segments FROM outage_causes
     WHERE silence_from BETWEEN $1::timestamptz - INTERVAL '5 seconds' AND $1::timestamptz + INTERVAL '5 seconds'
     ORDER BY silence_from
     LIMIT 1`,
    [at],
  );
  return row ? toStored(row) : null;
}
```

- [ ] **Step 3: Wire it into the ingest route**

In `app/api/ingest/route.ts`, add two imports after the `import { getCycleUsageCached } ...` line:

```ts
import { recordRouterEvidence } from "@/lib/outage-cause-store";
import { evidenceBodyFields, evidenceFromBody } from "@/lib/outage-evidence";
```

In `bodySchema`, replace:

```ts
    running: boolish.optional(),
    disabled: boolish.optional(),
  })
  .passthrough();
```

with:

```ts
    running: boolish.optional(),
    disabled: boolish.optional(),
    /** Outage evidence (lib/outage-evidence.ts). Each field falls back rather than failing the push. */
    ...evidenceBodyFields,
  })
  .passthrough();
```

Replace:

```ts
    const cycleCheck = await checkCycleAlerts(settings, now);

    return NextResponse.json({
      ...result,
      policy,
```

with:

```ts
    const cycleCheck = await checkCycleAlerts(settings, now);

    // Last, and never failing the push either: it catches its own errors.
    const outageEvidence = await recordRouterEvidence(evidenceFromBody(body, running), now);

    return NextResponse.json({
      ...result,
      policy,
      outage_evidence: outageEvidence,
```

- [ ] **Step 4: Run the full checks**

Run: `pnpm test; pnpm lint; pnpm exec tsc --noEmit`
Expected: all pass. Nothing here has a unit test: the logic is in Task 1, and the SQL is checked at rollout (Task 7). Stop here; the owner commits.

---

### Task 4: Router scripts and their documentation

**Files:**
- Modify: `router/quota-push.rsc`
- Modify: `lib/router/script-template.ts`
- Modify: `router/pppoe-reconnect.rsc`
- Modify: `router/internet-watchdog.md`
- Modify: `README.md`

**Interfaces:**
- Produces: push body fields read by Task 1's `evidenceBodyFields`:
  - `uptime_s` (num)
  - `ether_running` (`"true"`/`"false"`/`""`)
  - `ether_link_downs` (`"n"`/`""`)
  - `pppoe_link_downs` (num)
  - `netwatch` (`"up"`/`"down"`/`"unknown"`)
  - `planned_reconnects` (num)
  - `push_failures` (num)
  - `eth_down_at`, `eth_up_at`, `ppp_down_at`, `ppp_up_at`, `net_down_at`, `net_up_at` (`"n"`/`""`)
- Produces: global `qpPlanned`, incremented by `pppoe-reconnect`.

Every change below is made **twice**: once in `router/quota-push.rsc`, and once, with the same text, in `QUOTA_PUSH_TEMPLATE` in `lib/router/script-template.ts`. The only difference is the body line (Step 4), whose backslashes are doubled in the template. The one exception is the header comment in Step 1, which exists only in the `.rsc`.

- [ ] **Step 1: Header comment (`.rsc` only)**

In `router/quota-push.rsc`, insert before the line `# ----------------------------------------------------------------------------`:

```
# Outage evidence: every run also notes, in uptime seconds, when it first found
# the WAN port, the PPPoE link or the netwatch probe "internet-probe" down and
# when it found them up again. The push that ends a silence carries those marks
# and the app labels the outage: router off, roof link down, ISP dropped PPPoE,
# no internet. Uptime is used because the router's clock is wrong after a power
# cut until /ip cloud sets it. The marks are cleared after every successful
# push, and a reboot clears them anyway, which the short uptime reveals.
#
```

- [ ] **Step 2: Globals**

In both files, replace:

```
:if ([:typeof $qpFail] != "num") do={ :set qpFail 0 }
```

with:

```
:if ([:typeof $qpFail] != "num") do={ :set qpFail 0 }
:global qpEthDownAt
:global qpEthUpAt
:global qpPppDownAt
:global qpPppUpAt
:global qpNetDownAt
:global qpNetUpAt
:global qpPlanned
:if ([:typeof $qpPlanned] != "num") do={ :set qpPlanned 0 }
```

- [ ] **Step 3: Evidence block**

In both files, replace:

```
:local stamp ([/system clock get date] . " " . [/system clock get time])
```

with:

```
:local stamp ([/system clock get date] . " " . [/system clock get time])

# ---- outage evidence ----
# Best effort: a missing netwatch entry, or a WAN interface that is not a
# PPPoE client, leaves its field empty and never stops the push.
:local uptime [:tonum [/system resource get uptime]]
:local pppDowns [/interface get $id link-downs]
:local ethRunning ""
:local ethDowns ""
:do {
    :local lower [/interface pppoe-client get [find name=$iface] interface]
    :local eid [/interface find name=$lower]
    :set ethRunning [:tostr [/interface get $eid running]]
    :set ethDowns [/interface get $eid link-downs]
} on-error={ :set ethRunning "" }
:local net "unknown"
:do { :set net [/tool netwatch get [find name="internet-probe"] status] } on-error={ :set net "unknown" }

# The first run that finds a link down keeps its uptime until a push succeeds.
# Finding it up records the uptime; finding it down again forgets that, so the
# span runs from the first down to the last up.
:if ($ethRunning = "false") do={
    :if ([:typeof $qpEthDownAt] != "num") do={ :set qpEthDownAt $uptime }
    :set qpEthUpAt ""
}
:if (($ethRunning = "true") && ([:typeof $qpEthDownAt] = "num") && ([:typeof $qpEthUpAt] != "num")) do={ :set qpEthUpAt $uptime }
:if (!$running) do={
    :if ([:typeof $qpPppDownAt] != "num") do={ :set qpPppDownAt $uptime }
    :set qpPppUpAt ""
}
:if ($running && ([:typeof $qpPppDownAt] = "num") && ([:typeof $qpPppUpAt] != "num")) do={ :set qpPppUpAt $uptime }
:if ($net = "down") do={
    :if ([:typeof $qpNetDownAt] != "num") do={ :set qpNetDownAt $uptime }
    :set qpNetUpAt ""
}
:if (($net = "up") && ([:typeof $qpNetDownAt] = "num") && ([:typeof $qpNetUpAt] != "num")) do={ :set qpNetUpAt $uptime }
```

- [ ] **Step 4: Body line**

In `router/quota-push.rsc`, replace the whole `:local body` line with:

```
    :local body "{\"iface\":\"$iface\",\"event\":\"$event\",\"session_id\":\"$sid\",\"link_up\":\"$linkUp\",\"running\":$running,\"tx_bytes\":$outTx,\"rx_bytes\":$outRx,\"router_time\":\"$stamp\",\"uptime_s\":$uptime,\"ether_running\":\"$ethRunning\",\"ether_link_downs\":\"$ethDowns\",\"pppoe_link_downs\":$pppDowns,\"netwatch\":\"$net\",\"planned_reconnects\":$qpPlanned,\"push_failures\":$qpFail,\"eth_down_at\":\"$qpEthDownAt\",\"eth_up_at\":\"$qpEthUpAt\",\"ppp_down_at\":\"$qpPppDownAt\",\"ppp_up_at\":\"$qpPppUpAt\",\"net_down_at\":\"$qpNetDownAt\",\"net_up_at\":\"$qpNetUpAt\"}"
```

In `lib/router/script-template.ts`, replace the whole `:local body` line with the same line, every backslash doubled:

```
    :local body "{\\"iface\\":\\"$iface\\",\\"event\\":\\"$event\\",\\"session_id\\":\\"$sid\\",\\"link_up\\":\\"$linkUp\\",\\"running\\":$running,\\"tx_bytes\\":$outTx,\\"rx_bytes\\":$outRx,\\"router_time\\":\\"$stamp\\",\\"uptime_s\\":$uptime,\\"ether_running\\":\\"$ethRunning\\",\\"ether_link_downs\\":\\"$ethDowns\\",\\"pppoe_link_downs\\":$pppDowns,\\"netwatch\\":\\"$net\\",\\"planned_reconnects\\":$qpPlanned,\\"push_failures\\":$qpFail,\\"eth_down_at\\":\\"$qpEthDownAt\\",\\"eth_up_at\\":\\"$qpEthUpAt\\",\\"ppp_down_at\\":\\"$qpPppDownAt\\",\\"ppp_up_at\\":\\"$qpPppUpAt\\",\\"net_down_at\\":\\"$qpNetDownAt\\",\\"net_up_at\\":\\"$qpNetUpAt\\"}"
```

- [ ] **Step 5: Clear the marks after a successful push**

In both files, replace:

```
        :set pushed true
```

with:

```
        :set pushed true
        # the app has this silence's marks now; the next one starts clean
        :set qpEthDownAt ""
        :set qpEthUpAt ""
        :set qpPppDownAt ""
        :set qpPppUpAt ""
        :set qpNetDownAt ""
        :set qpNetUpAt ""
```

- [ ] **Step 6: Check that the template still matches the file**

Run: `pnpm test lib/router/script.test.ts`
Expected: PASS. If "are the same script" fails, diff the rendered template against the `.rsc` body. The usual cause is a backslash that was not doubled, or one doubled outside the body line.

- [ ] **Step 7: Count planned reconnects**

In `router/pppoe-reconnect.rsc`, replace:

```
:log info "pppoe-reconnect: cycling $iface"
```

with:

```
# Counted so the app can tell this planned drop from the ISP dropping the link;
# quota-push sends the count with every push. The watchdog's runs count too,
# which is harmless: netwatch being down outranks a planned drop.
:global qpPlanned
:if ([:typeof $qpPlanned] != "num") do={ :set qpPlanned 0 }
:set qpPlanned ($qpPlanned + 1)

:log info "pppoe-reconnect: cycling $iface"
```

- [ ] **Step 8: Document it**

Append to `router/internet-watchdog.md`:

```markdown

## What the app learns from it

`quota-push` reads this probe's `status` on every run, by the name
`internet-probe`, so keep that name. While the probe is down, the pushes fail.
The push that finally gets through carries the moment quota-push first saw the
probe down, and the outage is labelled **No internet from the ISP** on the
Sessions page, even though the watchdog was cycling PPPoE the whole time.
Without the probe, those outages show as **ISP dropped PPPoE** or as a
monitoring gap.
```

In `README.md`, insert before the line `### Retention`:

```markdown
### Outage causes

The router reports over the connection that fails, so while an outage lasts the
app only sees silence. Every run of `quota-push` therefore also notes, in uptime
seconds, when it first found the WAN port, the PPPoE link or the netwatch probe
down, and when it found them back. The push that ends a silence of more than 90
seconds carries those marks. `lib/outage-cause.ts` turns them into labelled
stretches, stored in `outage_causes`:

| Label | Evidence | Side |
| --- | --- | --- |
| Router off | uptime shorter than the silence (power cut, or the router unplugged); includes the first three minutes after boot | yours |
| Roof link down | the router stayed up but the WAN port lost its link | yours |
| No internet from the ISP | the netwatch probe was down | ISP |
| ISP dropped PPPoE | PPPoE went down with the port up and the probe fine | ISP |
| Scheduled reconnect | PPPoE drop matched by a `pppoe-reconnect` run | neither |
| App unreachable | everything was up, only the push failed | not downtime |

The Sessions page labels each outage and splits downtime by side. Silences with
no outage behind them are listed as monitoring gaps and not counted. Downtime
totals are unchanged: they still come from the sessions. What happened before a
reboot cannot be known, because the marks live in memory, so the whole stretch
before a boot is "router off". Outages from before the router sent this
evidence show as "cause unknown".

```

In the `README.md` project layout block, replace:

```
  sessions.ts            link session tracking and reporting
```

with:

```
  sessions.ts            link session tracking and reporting
  outages.ts             outages derived from sessions, with their causes attached
  outage-cause.ts        pure rules that label a silence from the router's evidence
  outage-cause-store.ts  router_status and outage_causes reads and writes
```

- [ ] **Step 9: Run the full checks**

Run: `pnpm test; pnpm lint; pnpm exec tsc --noEmit`
Expected: all pass. Do **not** install anything on the router; that is Task 7. Stop here; the owner commits.

---

### Task 5: What the owner sees on the Sessions page and the dashboard

**Files:**
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts`
- Create: `components/CauseChips.tsx`
- Create: `components/MonitoringGaps.tsx`
- Modify: `components/SessionsTable.tsx`
- Modify: `components/OutageSummary.tsx`
- Modify: `components/OutageCalendar.tsx`
- Modify: `components/StatusCard.tsx`
- Modify: `app/[lang]/(app)/sessions/page.tsx`

**Interfaces:**
- Consumes (Task 1): `causeSide`, `dominantCause`, `segmentSeconds`, `CauseSegment`, `CauseSide`
- Consumes (Task 3): `getSilences(window)`
- Consumes (Task 2): `attachCauses`, `monitoringGaps`, `downtimeSplit`, `downtimeSplitByDay`, `describeSplit`, `OutageWithCauses`, `DowntimeSplit`, `StoredSilence`
- Produces:
  - dictionary keys `sessions.causes.<OutageCause>`, `sessions.causeSegment`, `sessions.splitYours`, `sessions.splitIsp`, `sessions.splitNeutral`, `sessions.splitUnknown`, `sessions.calendarCellSplit`, `sessions.gapsHeading`, `sessions.gapsHint`, `sessions.gapRow`, `router.causeAfterReconnect`
  - Task 6 uses `sessions.causes`.

- [ ] **Step 1: English strings**

In `lib/i18n/dictionaries/en.ts`, in `sessions`, replace:

```ts
    calendarTooLong: "Choose a range of {max} days or fewer to see the calendar.",
  },
```

with:

```ts
    calendarTooLong: "Choose a range of {max} days or fewer to see the calendar.",
    /** One label per cause in lib/outage-cause.ts. */
    causes: {
      router_off: "Router off",
      roof_link_down: "Roof link down",
      no_internet: "No internet from the ISP",
      scheduled_reconnect: "Scheduled reconnect",
      pppoe_down: "ISP dropped PPPoE",
      app_unreachable: "App unreachable",
      unknown: "Cause unknown",
    },
    causeSegment: "{cause} {duration}",
    splitYours: "your side {duration}",
    splitIsp: "ISP {duration}",
    splitNeutral: "scheduled {duration}",
    splitUnknown: "cause unknown {duration}",
    calendarCellSplit: "{day}: offline {duration} ({split})",
    gapsHeading: "Monitoring gaps",
    gapsHint: "the router went quiet but the link did not drop; not counted as downtime",
    gapRow: "{cause} · {duration} · {time}",
  },
```

In `router`, replace:

```ts
    staleAlertSent: "Alert emailed at {time}.",
```

with:

```ts
    staleAlertSent: "Alert emailed at {time}.",
    causeAfterReconnect: "Whether this is on your side or the ISP's shows once the router reconnects.",
```

- [ ] **Step 2: Arabic strings**

In `lib/i18n/dictionaries/ar.ts`, in `sessions`, replace:

```ts
    calendarTooLong: "اختر مدة {max} يوماً أو أقل لعرض التقويم.",
  },
```

with:

```ts
    calendarTooLong: "اختر مدة {max} يوماً أو أقل لعرض التقويم.",
    causes: {
      router_off: "الراوتر مطفأ",
      roof_link_down: "انقطاع وصلة السطح",
      no_internet: "لا إنترنت من المزوّد",
      scheduled_reconnect: "إعادة اتصال مجدولة",
      pppoe_down: "المزوّد أسقط اتصال PPPoE",
      app_unreachable: "تعذّر الوصول إلى التطبيق",
      unknown: "السبب غير معروف",
    },
    causeSegment: "{cause} {duration}",
    splitYours: "من جهتك {duration}",
    splitIsp: "من المزوّد {duration}",
    splitNeutral: "مجدول {duration}",
    splitUnknown: "سبب غير معروف {duration}",
    calendarCellSplit: "{day}: منقطع {duration} ({split})",
    gapsHeading: "فجوات المراقبة",
    gapsHint: "توقف الراوتر عن الإبلاغ دون أن ينقطع الاتصال؛ لا تُحتسب ضمن الانقطاع",
    gapRow: "{cause} · {duration} · {time}",
  },
```

In `router`, replace:

```ts
    staleAlertSent: "أُرسل تنبيه بالبريد في {time}.",
```

with:

```ts
    staleAlertSent: "أُرسل تنبيه بالبريد في {time}.",
    causeAfterReconnect: "سيظهر ما إذا كان السبب من جهتك أو من المزوّد بعد عودة اتصال الراوتر.",
```

Run: `pnpm test lib/i18n.test.ts`
Expected: PASS.

- [ ] **Step 3: Cause chips**

Create `components/CauseChips.tsx`:

```tsx
"use client";

import { useI18n } from "@/components/I18nProvider";
import { fill } from "@/lib/i18n";
import { causeSide, segmentSeconds, type CauseSegment, type CauseSide } from "@/lib/outage-cause";

/** Amber for the owner's side, red for the ISP's, grey for neither, dashed for unknown. */
const TONE: Record<CauseSide, string> = {
  yours: "border-status-warning/40 bg-status-warning/10 text-amber-700 dark:text-status-warning",
  isp: "border-status-critical/40 bg-status-critical/10 text-status-critical",
  neutral: "border-border bg-border/40 text-muted",
  unknown: "border-dashed border-border text-muted",
};

/** An outage's causes in time order: `Router off 40m → No internet from the ISP 5m`. */
export function CauseChips({ causes }: { causes: CauseSegment[] }) {
  const { d, f } = useI18n();
  if (causes.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {causes.map((segment, i) => (
        <span key={`${segment.from}-${segment.cause}`} className="inline-flex items-center gap-1">
          {/* Mirrored on the Arabic page, where time runs right to left. */}
          {i > 0 && (
            <span aria-hidden className="inline-block text-muted rtl:-scale-x-100">
              →
            </span>
          )}
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[causeSide(segment.cause)]}`}>
            {fill(d.sessions.causeSegment, {
              cause: d.sessions.causes[segment.cause],
              duration: f.duration(segmentSeconds(segment)),
            })}
          </span>
        </span>
      ))}
    </span>
  );
}
```

- [ ] **Step 4: Chips in the sessions table**

In `components/SessionsTable.tsx`:

After `import { useI18n } from "@/components/I18nProvider";`, add:

```tsx
import { CauseChips } from "@/components/CauseChips";
```

After `import { fill, plural, type Dictionary } from "@/lib/i18n";`, add:

```tsx
import type { CauseSegment } from "@/lib/outage-cause";
```

Replace the component signature:

```tsx
export function SessionsTable({
  sessions,
  timezone,
}: {
  sessions: SessionSummary[];
  timezone: string;
}) {
```

with:

```tsx
export function SessionsTable({
  sessions,
  timezone,
  causesBySession = {},
}: {
  sessions: SessionSummary[];
  timezone: string;
  /** The causes of the outage that preceded each session, keyed by session id. */
  causesBySession?: Record<number, CauseSegment[]>;
}) {
```

In the mobile card, replace:

```tsx
                  <Pair
                    label={d.sessions.offlineBefore}
                    value={
                      s.downtime_before_seconds === null
                        ? d.common.empty
                        : f.duration(s.downtime_before_seconds)
                    }
                  />
```

with:

```tsx
                  <Pair
                    label={d.sessions.offlineBefore}
                    value={
                      s.downtime_before_seconds === null ? (
                        d.common.empty
                      ) : (
                        <span className="flex flex-col items-start gap-1">
                          {f.duration(s.downtime_before_seconds)}
                          <CauseChips causes={causesBySession[s.id] ?? []} />
                        </span>
                      )
                    }
                  />
```

In the desktop table, replace:

```tsx
                  <td className="px-4 py-3 text-end tabular-nums text-muted">
                    {s.downtime_before_seconds === null
                      ? d.common.empty
                      : f.duration(s.downtime_before_seconds)}
                  </td>
```

with:

```tsx
                  <td className="px-4 py-3 text-end tabular-nums text-muted">
                    {s.downtime_before_seconds === null ? (
                      d.common.empty
                    ) : (
                      <span className="flex flex-col items-end gap-1">
                        {f.duration(s.downtime_before_seconds)}
                        <CauseChips causes={causesBySession[s.id] ?? []} />
                      </span>
                    )}
                  </td>
```

- [ ] **Step 5: Split in the outage summary**

In `components/OutageSummary.tsx`, replace:

```tsx
import type { Outage } from "@/lib/outages";
```

with:

```tsx
import { describeSplit, downtimeSplit, type Outage, type OutageWithCauses } from "@/lib/outages";
```

Replace `  outages: Outage[];` (in the props type) with `  outages: OutageWithCauses[];`.

Replace:

```tsx
  const hints = [
    share !== null ? fill(s.downtimeShare, { percent: share.toFixed(share >= 10 ? 0 : 1) }) : null,
    ongoing ? fill(s.includingStillDown, { duration: f.duration(ongoing.seconds) }) : null,
  ].filter((part): part is string => part !== null);
```

with:

```tsx
  const hints = [
    share !== null ? fill(s.downtimeShare, { percent: share.toFixed(share >= 10 ? 0 : 1) }) : null,
    ongoing ? fill(s.includingStillDown, { duration: f.duration(ongoing.seconds) }) : null,
    // Whose side the listed outages were on, from the router's own evidence.
    ...describeSplit(downtimeSplit(outages), s, f.duration),
  ].filter((part): part is string => part !== null);
```

The `longest` reducer stays typed `Outage | null`, which accepts `OutageWithCauses`.

- [ ] **Step 6: Split in the calendar tooltips**

In `components/OutageCalendar.tsx`, replace:

```tsx
import type { DayDowntime } from "@/lib/outages";
```

with:

```tsx
import { describeSplit, type DayDowntime, type DowntimeSplit } from "@/lib/outages";
```

Replace the props:

```tsx
export async function OutageCalendar({
  byDay,
  from,
  to,
  timezone,
}: {
  byDay: DayDowntime[];
  from: Date | null;
  to: Date;
  timezone: string;
}) {
```

with:

```tsx
export async function OutageCalendar({
  byDay,
  splitByDay = new Map(),
  from,
  to,
  timezone,
}: {
  byDay: DayDowntime[];
  /** Downtime by side for each day, from lib/outages.ts downtimeSplitByDay. */
  splitByDay?: Map<string, DowntimeSplit>;
  from: Date | null;
  to: Date;
  timezone: string;
}) {
```

Replace:

```tsx
            const title =
              seconds > 0
                ? fill(s.calendarCell, { day, duration: f.duration(seconds) })
                : fill(s.calendarCellNone, { day });
```

with:

```tsx
            const split = splitByDay.get(day);
            const parts = split ? describeSplit(split, s, f.duration) : [];
            const title =
              seconds === 0
                ? fill(s.calendarCellNone, { day })
                : parts.length > 0
                  ? fill(s.calendarCellSplit, { day, duration: f.duration(seconds), split: parts.join(", ") })
                  : fill(s.calendarCell, { day, duration: f.duration(seconds) });
```

- [ ] **Step 7: Monitoring gaps**

Create `components/MonitoringGaps.tsx`:

```tsx
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { dominantCause } from "@/lib/outage-cause";
import type { StoredSilence } from "@/lib/outages";

/**
 * Silences that are not downtime (lib/outages.ts monitoringGaps), newest
 * first. Renders nothing when there are none, which is the usual case.
 */
export async function MonitoringGaps({ gaps, timezone }: { gaps: StoredSilence[]; timezone: string }) {
  if (gaps.length === 0) return null;
  const { d, f } = await getI18n();
  const s = d.sessions;

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-muted">{s.gapsHeading}</h2>
        <span className="text-xs text-muted">{s.gapsHint}</span>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {[...gaps].reverse().map((gap) => {
          const seconds = Math.round((Date.parse(gap.silence_to) - Date.parse(gap.silence_from)) / 1000);
          return (
            <li key={gap.silence_from} className="tabular-nums">
              {fill(s.gapRow, {
                cause: s.causes[dominantCause(gap.segments)],
                duration: f.duration(seconds),
                time: f.stamp(gap.silence_from, timezone),
              })}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 8: Wire the page**

In `app/[lang]/(app)/sessions/page.tsx`:

After `import { OutageCalendar } from "@/components/OutageCalendar";`, add:

```tsx
import { MonitoringGaps } from "@/components/MonitoringGaps";
```

Replace:

```tsx
import { downtimeByDay, downtimeWindowEnd, outagesFromSessions } from "@/lib/outages";
```

with:

```tsx
import type { CauseSegment } from "@/lib/outage-cause";
import { getSilences } from "@/lib/outage-cause-store";
import {
  attachCauses,
  downtimeByDay,
  downtimeSplitByDay,
  downtimeWindowEnd,
  monitoringGaps,
  outagesFromSessions,
} from "@/lib/outages";
```

Replace:

```tsx
  const [sessions, totals, latest] = await Promise.all([
    getSessions(window, LIMIT),
    getSessionTotals(window),
```

with:

```tsx
  const [sessions, totals, latest, silences] = await Promise.all([
    getSessions(window, LIMIT),
    getSessionTotals(window),
```

and replace the line `    getLatestSessionSummary(),` followed by `  ]);` with:

```tsx
    getLatestSessionSummary(),
    // What the router said about each silence in the range (lib/outage-cause.ts).
    getSilences(window),
  ]);
```

Replace:

```tsx
  const outages = outagesFromSessions(sessions, { from: range.from, to: until }, latest);
  const byDay = downtimeByDay(outages, settings.timezone);
```

with:

```tsx
  const outages = attachCauses(outagesFromSessions(sessions, { from: range.from, to: until }, latest), silences);
  const byDay = downtimeByDay(outages, settings.timezone);
  const splitByDay = downtimeSplitByDay(outages, settings.timezone);
  const gaps = monitoringGaps(silences, outages);
  // Each outage ends where the next session begins, so that session's row shows it.
  const causesBySession: Record<number, CauseSegment[]> = {};
  for (const outage of outages) {
    if (outage.next_session_id !== null) causesBySession[outage.next_session_id] = outage.causes;
  }
```

Replace:

```tsx
      <OutageCalendar byDay={byDay} from={range.from} to={until} timezone={settings.timezone} />

      <SessionsTable sessions={sessions} timezone={settings.timezone} />
```

with:

```tsx
      <OutageCalendar
        byDay={byDay}
        splitByDay={splitByDay}
        from={range.from}
        to={until}
        timezone={settings.timezone}
      />
      <MonitoringGaps gaps={gaps} timezone={settings.timezone} />

      <SessionsTable sessions={sessions} timezone={settings.timezone} causesBySession={causesBySession} />
```

- [ ] **Step 9: The "No contact" line**

In `components/StatusCard.tsx`, replace:

```tsx
              <dd className="text-xs text-muted">
                {fill(d.router.noContactExplanation, {
                  duration: f.duration(state.session.seconds_since_seen),
                })}
              </dd>
```

with:

```tsx
              <dd className="text-xs text-muted">
                {fill(d.router.noContactExplanation, {
                  duration: f.duration(state.session.seconds_since_seen),
                })}
              </dd>
              <dd className="text-xs text-muted">{d.router.causeAfterReconnect}</dd>
```

- [ ] **Step 10: Run the full checks**

Run: `pnpm test; pnpm lint; pnpm exec tsc --noEmit`
Expected: all pass.

- [ ] **Step 11: Look at it**

Run `pnpm dev`, sign in, and open `/en/sessions` and `/ar/sessions`. With no `outage_causes` rows yet:
- every outage row shows one dashed "Cause unknown" chip
- the Downtime tile hint has no split
- the calendar tooltips are unchanged
- there is no Monitoring gaps section

If the database already has the Task 3 schema, check the labels by inserting one row. **Ask the owner first; this writes to their database.** Replace the times with the start and end of a real outage shown on the page:

```sql
INSERT INTO outage_causes (silence_from, silence_to, segments, evidence_after)
VALUES ('<outage from>', '<outage to>',
        '[{"from":"<outage from>","to":"<outage to>","cause":"router_off"}]', '{}');
```

Reload. That row now shows an amber "Router off" chip, and the tile hint reads "your side …". Delete the row afterwards:

```sql
DELETE FROM outage_causes WHERE evidence_after = '{}';
```

Stop here; the owner commits.

---

### Task 6: The cause in the "router is back" mail

Requires Task 5 (`sessions.causes`) and Task 3 (`findSilenceStartingAt`).

**Files:**
- Modify: `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ar.ts`
- Modify: `lib/email-link-template.ts`
- Test: `lib/email-link-template.test.ts`
- Modify: `lib/cron/stale.ts`

**Interfaces:**
- Consumes: `CauseSegment`, `segmentSeconds` (Task 1); `findSilenceStartingAt(at: Date)` (Task 3); `d.sessions.causes` (Task 5)
- Produces: `LinkReport.causes?: CauseSegment[] | null`

- [ ] **Step 1: Write the failing tests**

In `lib/email-link-template.test.ts`, add inside `describe("renderLinkEmail", ...)`, after the "recovered: different subject, heading and footer" test:

```ts
  test("recovered names what happened when the router reported it", () => {
    const { text, html } = renderLinkEmail(
      report({
        kind: "recovered",
        silent_seconds: 2700,
        causes: [
          { from: "2026-09-14T08:00:00.000Z", to: "2026-09-14T08:40:00.000Z", cause: "router_off" },
          { from: "2026-09-14T08:40:00.000Z", to: "2026-09-14T08:45:00.000Z", cause: "pppoe_down" },
        ],
      }),
    );
    expect(text).toContain("What happened: Router off (40m 00s), then ISP dropped PPPoE (5m 00s).");
    expect(html).toContain("What happened: Router off (40m 00s), then ISP dropped PPPoE (5m 00s).");
  });

  test("without causes the recovered mail says nothing about them", () => {
    expect(renderLinkEmail(report({ kind: "recovered" })).text).not.toContain("What happened");
    expect(renderLinkEmail(report({ kind: "recovered", causes: [] })).text).not.toContain("What happened");
  });

  test("Arabic names the causes in Arabic", () => {
    const { text } = renderLinkEmail(
      report({
        kind: "recovered",
        locale: "ar",
        causes: [{ from: "2026-09-14T08:00:00.000Z", to: "2026-09-14T08:40:00.000Z", cause: "router_off" }],
      }),
    );
    expect(text).toContain("ما حدث: الراوتر مطفأ (40د 00ث).");
  });
```

Run: `pnpm test lib/email-link-template.test.ts`
Expected: FAIL. The first and third new tests fail because the text has no "What happened" line. vitest does not type-check, so the unknown `causes` property itself is not what fails; `tsc` would flag it.

- [ ] **Step 2: Strings**

In `lib/i18n/dictionaries/en.ts`, in `emailLink`, replace:

```ts
    dashboardLine: "Dashboard: {url}",
  },
```

with:

```ts
    dashboardLine: "Dashboard: {url}",
    bodyCause: "What happened: {causes}.",
    causePart: "{cause} ({duration})",
    causeJoiner: ", then ",
  },
```

In `lib/i18n/dictionaries/ar.ts`, in `emailLink`, replace:

```ts
    dashboardLine: "لوحة التحكم: {url}",
  },
```

with:

```ts
    dashboardLine: "لوحة التحكم: {url}",
    bodyCause: "ما حدث: {causes}.",
    causePart: "{cause} ({duration})",
    causeJoiner: "، ثم ",
  },
```

- [ ] **Step 3: Render it**

In `lib/email-link-template.ts`:

After `import { makeFormatters } from "@/lib/i18n/format";`, add:

```ts
import { segmentSeconds, type CauseSegment } from "@/lib/outage-cause";
```

In `interface LinkReport`, after `  app_url: string | null;`, add:

```ts
  /**
   * What the router reported about the silence (lib/outage-cause.ts), for the
   * all-clear. Absent or empty when it reported nothing, e.g. an old script.
   */
  causes?: CauseSegment[] | null;
```

Replace:

```ts
  const footer = stale ? t.footerStale : t.footerRecovered;
```

with:

```ts
  const footer = stale ? t.footerStale : t.footerRecovered;
  const causeLine =
    !stale && report.causes && report.causes.length > 0
      ? fill(t.bodyCause, {
          causes: report.causes
            .map((segment) =>
              fill(t.causePart, {
                cause: d.sessions.causes[segment.cause],
                duration: formatDuration(segmentSeconds(segment), d.duration),
              }),
            )
            .join(t.causeJoiner),
        })
      : null;
```

Replace:

```ts
  const textLines = [heading, "", body];
```

with:

```ts
  const textLines = [heading, "", body];
  if (causeLine) textLines.push("", causeLine);
```

Replace:

```ts
  <p style="margin:0 0 16px;color:#444;font-size:14px;line-height:1.5">${esc(body)}</p>
```

with:

```ts
  <p style="margin:0 0 16px;color:#444;font-size:14px;line-height:1.5">${esc(body)}</p>
  ${causeLine ? `<p style="margin:0 0 16px;color:${C.ink};font-size:14px;line-height:1.5">${esc(causeLine)}</p>` : ""}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test lib/email-link-template.test.ts`
Expected: PASS, including the existing tests.

- [ ] **Step 5: Look up the cause in the stale job**

In `lib/cron/stale.ts`, after `import { renderLinkEmail } from "@/lib/email-link-template";`, add:

```ts
import { findSilenceStartingAt } from "@/lib/outage-cause-store";
```

Replace:

```ts
    const ended = before ? Math.round((lastReadingAt.getTime() - before.getTime()) / 1000) : 0;
    const email = renderLinkEmail({
      kind: "recovered",
      locale: alertLocale(settings),
      last_reading_at: lastReadingAt.toISOString(),
      silent_seconds: ended,
      timezone: settings.timezone,
      app_url: appUrl(),
    });
```

with:

```ts
    const ended = before ? Math.round((lastReadingAt.getTime() - before.getTime()) / 1000) : 0;
    // The push that ended the silence has already stored what the router saw.
    // Failing to read it only costs the mail its cause line.
    const silence = before ? await findSilenceStartingAt(before).catch(() => null) : null;
    const email = renderLinkEmail({
      kind: "recovered",
      locale: alertLocale(settings),
      last_reading_at: lastReadingAt.toISOString(),
      silent_seconds: ended,
      timezone: settings.timezone,
      app_url: appUrl(),
      causes: silence?.segments ?? null,
    });
```

- [ ] **Step 6: Run the full checks**

Run: `pnpm test; pnpm lint; pnpm exec tsc --noEmit`
Expected: all pass. Stop here; the owner commits.

---

### Task 7: Rollout and hardware checks (every step needs the owner's OK at the time)

No code, unless check 4 takes the second branch. Before each step, say what it will do and wait for a yes.

- [ ] **Step 1: Schema**

Ask the owner to run it, or to approve running it:

```bash
psql "$DATABASE_URL" -f schema.sql
```

Verify: `SELECT to_regclass('router_status'), to_regclass('outage_causes');` returns both names.

- [ ] **Step 2: Deploy the app**

The owner deploys as usual. The old router script keeps working: its pushes carry no evidence, so `outage_evidence` in the response reads `"skipped"`.

- [ ] **Step 3: Install the scripts**

The owner pastes `router/pppoe-reconnect.rsc` (below the dashed line) over the `pppoe-reconnect` script, and the script rendered on `/settings` over `quota-push`, both in **System > Scripts**. The same can be done over SSH, if the owner approves.

Verify, read-only:
- `/system script environment print` lists `qpPlanned`, and after a minute `qpEthDownAt` and the other marks exist, empty.
- The router log shows `quota-push: sample` lines and no errors.
- `SELECT recorded_at, evidence FROM router_status;` has a row from the last 30 s, with `uptime_s`, `netwatch: "up"`, `ether_running: true` and `ether_link_downs: 0`.

- [ ] **Step 4: Check 1, PPPoE down (also checks that runs never overlap)**

With the owner's OK, on the router:

```
/interface pppoe-client disable pppoe-out1
```

Wait 120 s. During the wait, `/system script job print` must never list more than one `quota-push`, and the log's `POST ... failed` lines must be about 30 s apart. If runs pile up, stop and re-enable; `/tool fetch` is hanging and the script needs a timeout before going further. Then:

```
/interface pppoe-client enable pppoe-out1
```

Within a minute of the link returning:

```sql
SELECT silence_from, silence_to, segments FROM outage_causes ORDER BY id DESC LIMIT 1;
```

Expected: one segment, `pppoe_down`, spanning the silence. The Sessions page shows a red "ISP dropped PPPoE" chip on the new session.

- [ ] **Step 5: Check 2, router off**

The owner unplugs the MikroTik for 2 minutes, then plugs it back in. Expected: newest row `router_off` for the whole silence, because the startup grace covers the dial. The Sessions page shows an amber "Router off" chip.

- [ ] **Step 6: Check 3, roof cable (settles the spec's open point)**

The owner unplugs the roof cable at the power bank for 2 minutes. The router stays powered. Meanwhile, over SSH:

```
/interface print where name=ISP-ether1
```

- **ISP-ether1 loses its `R` (running) flag:** the newest row should be `roof_link_down`. Nothing else to do.
- **ISP-ether1 stays running:** the power bank switches the link, and a dead roof switch looks like the ISP dropping PPPoE. Make these changes, then run `pnpm test; pnpm lint; pnpm exec tsc --noEmit`:
  - In `lib/outage-cause.ts` `causeSide`, move `case "pppoe_down":` from the `"isp"` group into the `default` group, so it returns `"unknown"`.
  - In `lib/outage-cause.test.ts`, change `expect(causeSide("pppoe_down")).toBe("isp");` to `expect(causeSide("pppoe_down")).toBe("unknown");`.
  - In `lib/i18n/dictionaries/en.ts`, set `pppoe_down: "Couldn't reach the ISP (roof equipment or ISP)",`.
  - In `lib/i18n/dictionaries/ar.ts`, set `pppoe_down: "تعذّر الوصول إلى المزوّد (معدات السطح أو المزوّد)",`.
  - Update the email test's expected text to `"What happened: Router off (40m 00s), then Couldn't reach the ISP (roof equipment or ISP) (5m 00s)."`.
  - In the spec's Open point and the README table, record which branch was taken.

- [ ] **Step 7: The mail**

After check 2 or 3, and provided the silence passed `stale_after_minutes` (10 by default; a 2-minute test will not), the next tick's "The router is reporting again" mail carries the "What happened: …" line. If no test ran long enough, skip this step and say so in the report.

Stop here; the owner commits any branch changes.
