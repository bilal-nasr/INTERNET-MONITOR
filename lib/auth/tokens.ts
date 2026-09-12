/**
 * Session and reset tokens.
 *
 * A token is 32 random bytes, which is the value that goes into the cookie or
 * the reset link. The database only ever holds its SHA-256, so a copy of the
 * table gives away nothing that can be presented back. Hashing is unsalted on
 * purpose: the input is already 256 bits of entropy, so there is nothing to
 * guess, and an unsalted hash is what lets the row be found by an index.
 */

import { createHash, randomBytes } from "node:crypto";

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Reject anything that is not shaped like a token we issued, before it reaches a query. */
export function looksLikeToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
