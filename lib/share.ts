/**
 * The read-only link.
 *
 * One token, stored in `settings.share_token`, opens the dashboard without a
 * sign-in and serves a JSON feed of the same figures. It is a bearer secret:
 * anyone holding it can read usage, nothing more. Turning sharing off sets the
 * column to NULL; replacing the link stores a fresh token, so the old link
 * stops working the moment the new one exists.
 *
 * Tokens are shaped like session tokens on purpose, so `looksLikeToken` can
 * throw out anything else before it is compared.
 */

import { timingSafeEqual } from "node:crypto";
import { generateToken, looksLikeToken } from "@/lib/auth/tokens";

export function generateShareToken(): string {
  return generateToken();
}

/**
 * Constant-time equality. Both sides must be present and token-shaped, which
 * also makes the lengths equal, as `timingSafeEqual` requires.
 */
export function tokensMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!looksLikeToken(a) || !looksLikeToken(b)) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
