import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { EmailError } from "@/lib/email";
import type { Dictionary } from "@/lib/i18n";
import { SettingsNotSeededError } from "@/lib/settings";

/**
 * Map known error types to HTTP status codes and a JSON body.
 *
 * Two audiences, two texts. `error` is a stable machine code and the server log
 * keeps the original English detail, because that is what gets pasted into a
 * bug report. `message` is what the settings page puts in front of a person, so
 * it is written in the language they asked for.
 *
 * Passing no dictionary keeps the original detail as the message, which is what
 * a caller with no language of its own -- the router's push script -- wants.
 */
export function errorResponse(err: unknown, d?: Dictionary): NextResponse {
  const detail = err instanceof Error ? err.message : String(err);
  let status = 500;
  let code = "internal_error";
  let message = detail;

  if (err instanceof EmailError) {
    status = 502;
    code = "email_error";
    if (d) message = `${d.errors.emailFailed} ${detail}`;
  } else if (err instanceof SettingsNotSeededError) {
    status = 503;
    code = "settings_not_seeded";
    if (d) message = d.errors.settingsNotSeeded;
  } else if (d) {
    message = d.errors.internal;
  }

  console.error(`[api] ${code}: ${detail}`);
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
