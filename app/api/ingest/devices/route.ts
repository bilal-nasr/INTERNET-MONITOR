import { NextResponse } from "next/server";
import { badRequest, errorResponse, isCronAuthorized } from "@/lib/api";
import { parseDevicePush } from "@/lib/devices/parse";
import { storeDevicePush } from "@/lib/devices/store";
import { getSettings } from "@/lib/settings";

export const maxDuration = 60;

/**
 * Per-device counters, pushed by the router's devices-push script. Same bearer
 * token as /api/ingest. Discarded while per-device tracking is off in
 * settings, with a 200 so the router does not log an error every minute.
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
    const stored = await storeDevicePush(parsed.data);
    return NextResponse.json({ status: "ok", ...stored });
  } catch (err) {
    return errorResponse(err);
  }
}
