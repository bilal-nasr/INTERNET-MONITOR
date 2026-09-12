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

/**
 * The one API path that is answered without a session: the share feed, which
 * carries its own credential in the URL and checks it itself. The proxy asks
 * this before it asks for a cookie.
 *
 * Spelled out segment by segment rather than as a prefix, because a prefix
 * would also stand aside for anything else that happens to start with the same
 * letters: `/api/share` itself, which creates and revokes the link and must
 * stay behind the session, and any `/api/share.../` route added later. The
 * token segment is held to the same shape as an issued token, so the match is
 * the route that exists and nothing more.
 */
export function isPublicApiPath(pathname: string): boolean {
  const [empty, api, share, token, usage, ...rest] = pathname.split("/");
  return (
    empty === "" &&
    api === "api" &&
    share === "share" &&
    looksLikeToken(token) &&
    usage === "usage" &&
    rest.length === 0
  );
}
