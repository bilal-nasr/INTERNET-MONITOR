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
    case "unknown":
      return "unknown";
    default: {
      const exhaustive: never = cause;
      return exhaustive;
    }
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

  // An up mark is checked for plausibility even when there is no down mark, so
  // a bogus up-only reading still trips `suspect`. An up mark that cannot be
  // placed makes the span it would have closed "unknown" instead of handing
  // it the layer's cause: the instant is not known, so neither is what was
  // happening up to it.
  const buildLayer = (downAt: number | null, upAt: number | null, cause: OutageCause): { span: Span | null; cause: OutageCause } => {
    const down = instant(downAt);
    const upInstant = instant(upAt);
    if (down === null) return { span: null, cause };
    const unplaceableUp = upAt !== null && upInstant === null;
    const up = upInstant ?? toMs;
    const start = down - windowFrom <= LEAD_SNAP_MS ? windowFrom : down;
    const end = toMs - up <= TAIL_SNAP_MS ? toMs : up;
    if (end <= start) return { span: null, cause };
    return { span: { from: start, to: end }, cause: unplaceableUp ? "unknown" : cause };
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
  const ethLayer = buildLayer(after.eth_down_at, after.eth_up_at, "roof_link_down");
  const netLayer = buildLayer(after.net_down_at, after.net_up_at, "no_internet");
  const pppLayer = buildLayer(after.ppp_down_at, after.ppp_up_at, pppoeCause);
  const layers = [ethLayer, netLayer, pppLayer];

  // Time no mark covers. A link-down counter may only fill it in when that
  // same layer has no mark span at all: once the layer has its own timing,
  // an uncovered gap next to it is not the counter's to explain.
  const allFine = after.netwatch === "up" && after.ether_running === true && after.pppoe_running === true;
  const noSpanAtAll = ethLayer.span === null && netLayer.span === null && pppLayer.span === null;
  const fallback: OutageCause = suspect
    ? "unknown"
    : ethLayer.span === null && rose(after.ether_link_downs, before?.ether_link_downs)
      ? "roof_link_down"
      : pppLayer.span === null && rose(after.pppoe_link_downs, before?.pppoe_link_downs)
        ? pppoeCause
        : noSpanAtAll && allFine
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
