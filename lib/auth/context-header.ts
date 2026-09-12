/**
 * How the proxy tells a Server Component who is signed in.
 *
 * The proxy has looked the access token up before the page renders. Rather than
 * look it up a second time, it writes what it found into a request header, and
 * `getAuth` reads that. The header is set on the request the proxy forwards,
 * never on the response, so the browser never sees it; and the proxy strips any
 * copy that arrived from outside, so nothing a client sends can be mistaken for
 * the proxy's verdict.
 */

import type { AuthContext } from "@/lib/auth/sessions";

export const AUTH_CONTEXT_HEADER = "x-qm-auth";

export function encodeAuthContext(context: AuthContext): string {
  return Buffer.from(JSON.stringify(context), "utf8").toString("base64url");
}

/** Null for anything that is not a value `encodeAuthContext` produced. */
export function decodeAuthContext(value: string | null | undefined): AuthContext | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.user)) return null;
  const { sessionId, user } = parsed;
  if (typeof sessionId !== "number" || typeof user.id !== "number") return null;
  if (typeof user.username !== "string") return null;
  if (user.email !== null && typeof user.email !== "string") return null;
  return { sessionId, user: { id: user.id, username: user.username, email: user.email } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
