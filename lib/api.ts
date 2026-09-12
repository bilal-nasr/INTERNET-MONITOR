import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiAuth, UnauthorizedError } from "@/lib/auth/server";
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

  if (err instanceof UnauthorizedError) {
    status = 401;
    code = "unauthorized";
    if (d) message = d.errors.unauthorized;
  } else if (err instanceof EmailError) {
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

  // A missing session is routine, not a fault worth a stack of log lines.
  if (status !== 401) console.error(`[api] ${code}: ${detail}`);
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

/**
 * The 401 a route answers with when no live session is presented, or null when
 * one is. The proxy already turns such requests away; this is the check that
 * does not depend on the proxy's matcher being right.
 */
export async function rejectUnauthenticated(request: Request, d?: Dictionary): Promise<NextResponse | null> {
  try {
    await requireApiAuth(request);
    return null;
  } catch (err) {
    return errorResponse(err, d);
  }
}
