import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, isCronAuthorized } from "@/lib/api";
import { recordReading } from "@/lib/poll";
import { getSettings } from "@/lib/settings";

export const maxDuration = 60;

const boolish = z.union([
  z.boolean(),
  z.enum(["true", "false", "yes", "no"]).transform((v) => v === "true" || v === "yes"),
]);

const bodySchema = z.object({
  tx_bytes: z.coerce.number().int().nonnegative(),
  rx_bytes: z.coerce.number().int().nonnegative(),
  interface: z.string().trim().max(100).optional(),
  running: boolish.optional(),
  disabled: boolish.optional(),
});

/** Accept JSON, or form-encoded bodies (what RouterOS sends when no Content-Type is set). */
function parseBody(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  return Object.fromEntries(new URLSearchParams(trimmed));
}

/**
 * Push mode: the router (or anything on its LAN) sends the WAN counters here,
 * for setups where the router cannot be reached from the internet (CGNAT).
 * Same secret as /api/poll: Authorization: Bearer <CRON_SECRET>.
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
      return NextResponse.json({ status: "paused", message: "polling_enabled is false; reading discarded" });
    }
    const result = await recordReading(
      settings,
      {
        name: body.interface ?? settings.wan_interface_name,
        txBytes: body.tx_bytes,
        rxBytes: body.rx_bytes,
        running: body.running ?? true,
        disabled: body.disabled ?? false,
      },
      "push",
    );
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
