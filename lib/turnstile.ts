/**
 * Cloudflare Turnstile, the bot check on the pages that answer strangers:
 * sign in, forgot password, reset password, and the share link.
 *
 * Both keys are read at request time rather than inlined at build, so one
 * image serves an install with Turnstile and one without. With either key
 * missing the check is off everywhere: the widget is not rendered and every
 * verification passes, which is what a LAN-only install and the tests want.
 *
 * A failed call to Cloudflare fails closed. The widget only hands out a token
 * once Cloudflare has answered the browser, so a siteverify outage that leaves
 * the browser side working is rare, and letting requests through then would
 * make the check a formality for anyone able to provoke one.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { connection } from "next/server";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 10_000;
/** Cloudflare documents tokens as at most 2048 characters. */
const MAX_TOKEN_LENGTH = 2048;

/** The cookie a share-link visitor carries once they have passed the check. */
export const SHARE_PASS_COOKIE = "qm_share_pass";
/** Long enough for a wall display to stay up through a working day. */
export const SHARE_PASS_TTL_SECONDS = 12 * 60 * 60;

interface TurnstileKeys {
  siteKey: string;
  secretKey: string;
}

function keys(): TurnstileKeys | null {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim();
  return siteKey && secretKey ? { siteKey, secretKey } : null;
}

export function turnstileEnabled(): boolean {
  return keys() !== null;
}

/**
 * The site key for a Server Component to hand to the widget, or null when the
 * check is off. Opts the render out of prerendering, so the key is the one in
 * the running environment and not the one present at build.
 */
export async function getTurnstileSiteKey(): Promise<string | null> {
  await connection();
  return keys()?.siteKey ?? null;
}

/**
 * Ask Cloudflare whether a widget token is genuine. True when the check is off.
 * Each token is good for one call, so a form must fetch a fresh one after a
 * failed submit.
 */
export async function verifyTurnstile(token: unknown, ip: string | null): Promise<boolean> {
  const k = keys();
  if (!k) return true;
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;

  const form = new URLSearchParams({ secret: k.secretKey, response: token });
  if (ip) form.set("remoteip", ip);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[turnstile] siteverify answered ${res.status}`);
      return false;
    }
    const body = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (!body.success) {
      console.warn(`[turnstile] rejected: ${(body["error-codes"] ?? []).join(", ") || "no reason given"}`);
    }
    return body.success === true;
  } catch (err) {
    console.error(`[turnstile] siteverify failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function sharePassSignature(secret: string, shareToken: string, expiresAt: number): Buffer {
  return createHmac("sha256", secret).update(`share-pass:${shareToken}:${expiresAt}`).digest();
}

/**
 * A pass for the share page: an expiry and an HMAC over it and the share
 * token, keyed with the Turnstile secret. Bound to the token, so replacing the
 * link voids every pass issued for the old one. Null when the check is off.
 */
export function issueSharePass(shareToken: string, now = Date.now()): string | null {
  const k = keys();
  if (!k) return null;
  const expiresAt = Math.floor(now / 1000) + SHARE_PASS_TTL_SECONDS;
  return `${expiresAt}.${sharePassSignature(k.secretKey, shareToken, expiresAt).toString("base64url")}`;
}

/** Whether a share page visitor may skip the check. Always true when it is off. */
export function sharePassValid(pass: string | null | undefined, shareToken: string, now = Date.now()): boolean {
  const k = keys();
  if (!k) return true;
  if (!pass) return false;

  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(pass);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (expiresAt * 1000 <= now) return false;

  const given = Buffer.from(match[2], "base64url");
  const expected = sharePassSignature(k.secretKey, shareToken, expiresAt);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
