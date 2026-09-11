import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { EmailError } from "@/lib/email";
import { SettingsNotSeededError } from "@/lib/settings";

/** Map known error types to HTTP status codes and a JSON body. */
export function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  let status = 500;
  let code = "internal_error";

  if (err instanceof EmailError) {
    status = 502;
    code = "email_error";
  } else if (err instanceof SettingsNotSeededError) {
    status = 503;
    code = "settings_not_seeded";
  }

  console.error(`[api] ${code}: ${message}`);
  return NextResponse.json({ error: code, message }, { status });
}

export function badRequest(message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: "bad_request", message, details }, { status: 400 });
}

/** Constant-time check of `Authorization: Bearer <CRON_SECRET>`, the shared secret the router sends. */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
