import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse, rejectUnauthenticated } from "@/lib/api";
import { normaliseMac } from "@/lib/devices/parse";
import { renameDevice } from "@/lib/devices/usage";
import type { Dictionary } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";

function bodySchema(d: Dictionary) {
  return z.object({
    name: z.string().trim().max(100, d.errors.deviceNameTooLong).nullable(),
  });
}

/** Give a device a name, or clear it with null. */
export async function PUT(request: Request, { params }: { params: Promise<{ mac: string }> }) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;

  const mac = normaliseMac(decodeURIComponent((await params).mac));
  if (!mac) return badRequest(d.errors.notAMac);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(d.errors.badJson);
  }
  const parsed = bodySchema(d).safeParse(body);
  if (!parsed.success) {
    return badRequest(d.errors.validationFailed, z.flattenError(parsed.error).fieldErrors);
  }

  try {
    const row = await renameDevice(mac, parsed.data.name || null);
    if (!row) return NextResponse.json({ error: "not_found", message: d.errors.deviceNotFound }, { status: 404 });
    return NextResponse.json({
      mac: row.mac,
      name: row.name,
      hostname: row.hostname,
      ip: row.ip,
      last_seen: row.last_seen.toISOString(),
    });
  } catch (err) {
    return errorResponse(err, d);
  }
}
