import { NextResponse } from "next/server";
import { z } from "zod";
import { checkCycleAlerts } from "@/lib/alerts/cycle";
import { badRequest, errorResponse, isCronAuthorized } from "@/lib/api";
import { getCycleUsageCached } from "@/lib/cycle-cache";
import { db } from "@/lib/db";
import { noteRouterStatus, recordRouterEvidence } from "@/lib/outage-cause-store";
import { evidenceBodyFields, evidenceFromBody } from "@/lib/outage-evidence";
import { recordReading, storeReading } from "@/lib/readings";
import { decidePolicy, type Policy } from "@/lib/router/policy";
import { applySessionEvent } from "@/lib/sessions";
import { getSettings } from "@/lib/settings";
import { parseRouterTimestamp } from "@/lib/time";

export const maxDuration = 60;

const boolish = z.union([
  z.boolean(),
  z.enum(["true", "false", "yes", "no"]).transform((v) => v === "true" || v === "yes"),
]);

const bodySchema = z
  .object({
    // Capped at the safe-integer limit: beyond it the value neither survives a
    // round trip through JS nor fits a BIGINT column.
    tx_bytes: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    rx_bytes: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /** The router script sends "iface"; "interface" is accepted too. */
    iface: z.string().trim().max(100).optional(),
    interface: z.string().trim().max(100).optional(),
    /** Informational: the server decides what actually happened. */
    event: z.string().trim().max(40).optional(),
    /** Router's session identifier, normally `last-link-up-time`. May be empty. */
    session_id: z.string().trim().max(100).optional(),
    link_up: z.string().trim().max(100).optional(),
    router_time: z.string().trim().max(100).optional(),
    running: boolish.optional(),
    disabled: boolish.optional(),
    /** Outage evidence (lib/outage-evidence.ts). Each field falls back rather than failing the push. */
    ...evidenceBodyFields,
  })
  .passthrough();

/** Accept JSON, or form-encoded bodies (what RouterOS sends when no Content-Type is set). */
function parseBody(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  return Object.fromEntries(new URLSearchParams(trimmed));
}

/**
 * The only way readings enter the system: the router's script posts its WAN
 * counters here. Besides storing the reading and applying the quota logic, this
 * tracks link sessions so uptime and per-session traffic can be reported.
 * Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = parseBody(await request.text());
  } catch {
    return badRequest("body must be JSON or form-encoded");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest("validation failed", z.flattenError(parsed.error).fieldErrors);
  }
  const body = parsed.data;

  try {
    const settings = await getSettings();
    if (!settings.polling_enabled) {
      // A paused period is not an outage, so the silence it leaves must not be recorded as one.
      await noteRouterStatus(evidenceFromBody(body, body.running ?? true), new Date());
      return NextResponse.json({
        status: "paused",
        message: "polling_enabled is false; reading discarded",
        policy: { throttle: false, reason: null } satisfies Policy,
      });
    }

    const now = new Date();
    const interfaceName = body.iface ?? body.interface ?? settings.wan_interface_name;
    const running = body.running ?? true;

    // Every stored timestamp uses server time. The one value only the router
    // knows is when the link came up; since link_up and router_time are read
    // from the same clock, subtracting the measured skew converts link_up to
    // server time even when the router's clock is wrong.
    const routerNow = parseRouterTimestamp(body.router_time, settings.timezone);
    const skewMs = routerNow ? routerNow.getTime() - now.getTime() : 0;
    const reportedLinkUp = parseRouterTimestamp(body.link_up, settings.timezone);
    const linkUpAt = reportedLinkUp ? new Date(reportedLinkUp.getTime() - skewMs) : null;
    const clockSkewSeconds = routerNow ? Math.round(skewMs / 1000) : null;

    const wanCounters = {
      name: interfaceName,
      txBytes: body.tx_bytes,
      rxBytes: body.rx_bytes,
      running,
      disabled: body.disabled ?? false,
    };

    // Order matters. The reading goes in first because it is the only fact that
    // cannot be rebuilt: session totals and quota usage are both derived from
    // the counters, so if a later step fails they simply catch up on the next
    // push, while a lost reading is lost for good.
    const stored = await storeReading(settings, wanCounters, now, null);

    const session = await applySessionEvent({
      sessionKey: body.session_id ?? "",
      interfaceName,
      linkUpAt,
      running,
      txCounter: body.tx_bytes,
      rxCounter: body.rx_bytes,
      at: now,
    });

    if (session.session) {
      await db.none("UPDATE interface_readings SET session_key = $2 WHERE id = $1", [
        stored.reading.id,
        session.session.session_key,
      ]);
    }

    const result = await recordReading(settings, wanCounters, now, null, stored);

    // The reply carries what the router should do about the LAN. The cycle
    // figure is cached, and a failure to read it leaves the cap out of the
    // decision rather than failing the push: the reading is already stored.
    let capExceeded = false;
    if (settings.throttle_on_cap) {
      try {
        capExceeded = (await getCycleUsageCached(settings, now)).over;
      } catch (err) {
        console.warn("[ingest] could not read the cycle total for the policy", err);
      }
    }
    const policy: Policy = decidePolicy({
      throttleOnBreach: settings.throttle_on_breach,
      throttleOnCap: settings.throttle_on_cap,
      windowActive: result.window.active,
      dailyExceeded: result.quota?.exceeded ?? false,
      capExceeded,
    });

    // Never fails the push: the reading is already stored, and the check
    // reports its own outcome in the response for the router log.
    const cycleCheck = await checkCycleAlerts(settings, now);

    // Last, and never failing the push either: it catches its own errors.
    const outageEvidence = await recordRouterEvidence(evidenceFromBody(body, running), now);

    return NextResponse.json({
      ...result,
      policy,
      outage_evidence: outageEvidence,
      reported_event: body.event ?? null,
      router_clock_skew_seconds: clockSkewSeconds,
      cycle_check: cycleCheck,
      session: session.session
        ? {
            id: session.session.id,
            action: session.action,
            key: session.session.session_key,
            started_at: session.session.started_at.toISOString(),
            ended_at: session.session.ended_at ? session.session.ended_at.toISOString() : null,
            tx_bytes: session.session.tx_bytes,
            rx_bytes: session.session.rx_bytes,
            total_bytes: session.session.total_bytes,
            samples: session.session.samples,
          }
        : { action: session.action },
      closed_session_id: session.closed?.id ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
