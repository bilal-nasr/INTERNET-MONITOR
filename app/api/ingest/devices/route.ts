import { NextResponse } from "next/server";
import { badRequest, errorResponse, isCronAuthorized } from "@/lib/api";
import { parseDevicePush } from "@/lib/devices/parse";
import { storeDevicePush } from "@/lib/devices/store";
import { getSettings } from "@/lib/settings";
import { parseRouterTimestamp } from "@/lib/time";

export const maxDuration = 60;

/**
 * Per-device counters, pushed by the router's devices-push script. Same bearer
 * token as /api/ingest. Discarded while per-device tracking is off in
 * settings, with a 200 so the router does not log an error every minute.
 *
 * A push is rejected only when nothing in it can be used. Entries that fail
 * validation are skipped and counted instead: a DHCP host-name is text the
 * device announced about itself, so one device with a strange name must not be
 * able to stop collection for every other device on the LAN, minute after
 * minute, until someone notices.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await request.text());
  } catch {
    return badRequest("body must be JSON");
  }
  const parsed = parseDevicePush(raw);
  if (!parsed.ok) return badRequest("validation failed", parsed.errors);

  try {
    const settings = await getSettings();
    if (!settings.devices_enabled) {
      return NextResponse.json({ status: "paused", message: "devices_enabled is false; push discarded" });
    }

    const now = new Date();
    const stored = await storeDevicePush(parsed.data, now);

    // Readings are stamped with server time, as every other table is. What
    // router_time is for is the same thing it is for on /api/ingest: measuring
    // the router's clock against the server's, so a router whose clock is
    // wrong is visible in its own log rather than silently shifting nothing.
    // There is no router-clock value in this push to correct -- counters carry
    // no timestamp -- so the skew is reported and not stored.
    const routerNow = parseRouterTimestamp(parsed.data.router_time, settings.timezone);

    return NextResponse.json({
      status: "ok",
      ...stored,
      /** Entries the push carried that could not be read. */
      skipped: parsed.skipped,
      errors: parsed.errors,
      router_clock_skew_seconds: routerNow
        ? Math.round((routerNow.getTime() - now.getTime()) / 1000)
        : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
