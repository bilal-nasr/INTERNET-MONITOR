/**
 * Signed-in browsers, as rows of `auth_sessions`.
 *
 * Two tokens per session. The access token is what every request presents and
 * lives fifteen minutes; when it lapses, the refresh token mints another in the
 * same row without asking for the password again. The refresh token's own
 * expiry slides forward on each use, so a browser that keeps coming back stays
 * signed in, and one that stays away for thirty days does not.
 *
 * Only hashes are stored. The tokens themselves exist in the cookies and
 * nowhere else.
 */

import { db } from "@/lib/db";
import { generateToken, hashToken, looksLikeToken } from "@/lib/auth/tokens";
import { describeUserAgent, type UserAgentDescription } from "@/lib/auth/user-agent";
import type { PublicUser } from "@/lib/auth/users";

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface IssuedAccess {
  access: string;
  accessExpiresAt: Date;
}

export interface IssuedTokens extends IssuedAccess {
  refresh: string;
  refreshExpiresAt: Date;
}

/** Who a request belongs to, once its access token has been checked. */
export interface AuthContext {
  sessionId: number;
  user: PublicUser;
}

export interface SessionMeta {
  userAgent: string | null;
  ip: string | null;
}

export function sessionMetaFromRequest(request: Request): SessionMeta {
  const forwarded = request.headers.get("x-forwarded-for");
  return {
    userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    ip: forwarded ? forwarded.split(",")[0].trim().slice(0, 100) : null,
  };
}

function expiries(now: Date) {
  return {
    accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_SECONDS * 1000),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000),
  };
}

export async function createSession(
  userId: number,
  meta: SessionMeta,
  now = new Date(),
): Promise<IssuedTokens> {
  const access = generateToken();
  const refresh = generateToken();
  const { accessExpiresAt, refreshExpiresAt } = expiries(now);
  await db.none(
    `INSERT INTO auth_sessions
       (user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at,
        created_at, last_used_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8)`,
    [
      userId,
      hashToken(access),
      hashToken(refresh),
      accessExpiresAt,
      refreshExpiresAt,
      now,
      meta.userAgent,
      meta.ip,
    ],
  );
  return { access, refresh, accessExpiresAt, refreshExpiresAt };
}

interface ContextRow {
  session_id: number;
  id: number;
  username: string;
  email: string | null;
}

function toContext(row: ContextRow): AuthContext {
  return {
    sessionId: row.session_id,
    user: { id: row.id, username: row.username, email: row.email },
  };
}

/** Null for anything that is not a live access token: absent, malformed, expired or revoked. */
export async function authenticateAccess(token: string | null | undefined): Promise<AuthContext | null> {
  if (!looksLikeToken(token)) return null;
  const row = await db.oneOrNone<ContextRow>(
    `SELECT s.id AS session_id, u.id, u.username, u.email
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.access_token_hash = $1 AND s.revoked_at IS NULL AND s.access_expires_at > now()`,
    [hashToken(token)],
  );
  return row ? toContext(row) : null;
}

export interface RefreshResult extends IssuedAccess {
  refreshExpiresAt: Date;
  context: AuthContext;
}

/**
 * Mint a new access token from a live refresh token. The refresh token itself
 * is kept rather than rotated: two requests racing to refresh at the same
 * moment then both succeed, instead of the second one logging the browser out.
 */
export async function refreshAccess(
  refreshToken: string | null | undefined,
  now = new Date(),
): Promise<RefreshResult | null> {
  if (!looksLikeToken(refreshToken)) return null;
  const access = generateToken();
  const { accessExpiresAt, refreshExpiresAt } = expiries(now);
  const row = await db.oneOrNone<ContextRow>(
    `WITH updated AS (
       UPDATE auth_sessions
       SET access_token_hash = $2, access_expires_at = $3, refresh_expires_at = $4, last_used_at = $5
       WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND refresh_expires_at > $5
       RETURNING id, user_id
     )
     SELECT updated.id AS session_id, u.id, u.username, u.email
     FROM updated JOIN users u ON u.id = updated.user_id`,
    [hashToken(refreshToken), hashToken(access), accessExpiresAt, refreshExpiresAt, now],
  );
  if (!row) return null;
  return { access, accessExpiresAt, refreshExpiresAt, context: toContext(row) };
}

/**
 * Log one browser out. Either token identifies the session; both are accepted
 * so logout still works after the access token has lapsed.
 */
export async function revokeSession(tokens: {
  access?: string | null;
  refresh?: string | null;
}): Promise<void> {
  const hashes = [tokens.access, tokens.refresh].filter(looksLikeToken).map(hashToken);
  if (hashes.length === 0) return;
  await db.none(
    `UPDATE auth_sessions SET revoked_at = now()
     WHERE revoked_at IS NULL AND (access_token_hash = ANY($1) OR refresh_token_hash = ANY($1))`,
    [hashes],
  );
}

/** Log every browser out, optionally sparing the one that asked (after a password change). */
export async function revokeAllSessions(userId: number, exceptSessionId?: number): Promise<void> {
  await db.none(
    `UPDATE auth_sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL AND ($2::int IS NULL OR id <> $2)`,
    [userId, exceptSessionId ?? null],
  );
}

// ------------------------------------------------------- listing ----

/** One live session as the settings page lists it. */
export interface SessionListRow {
  id: number;
  created_at: Date;
  last_used_at: Date;
  user_agent: string | null;
  ip: string | null;
  /** The session the request that asked for the list belongs to. */
  current: boolean;
}

/**
 * Every browser that can still act for the account: not revoked, refresh token
 * not yet expired. A lapsed access token alone does not drop a row, since the
 * browser can mint another one whenever it comes back.
 */
export function listSessions(userId: number, currentSessionId: number): Promise<SessionListRow[]> {
  return db.any<SessionListRow>(
    `SELECT id, created_at, last_used_at, user_agent, ip, (id = $2) AS current
     FROM auth_sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND refresh_expires_at > now()
     ORDER BY last_used_at DESC, id DESC`,
    [userId, currentSessionId],
  );
}

/** Sign one browser out by row id. Only the owner's rows; true when a live row was revoked. */
export async function revokeSessionById(userId: number, id: number): Promise<boolean> {
  const row = await db.oneOrNone<{ id: number }>(
    `UPDATE auth_sessions SET revoked_at = now()
     WHERE id = $2 AND user_id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [userId, id],
  );
  return row !== null;
}

export interface PublicSession {
  id: number;
  created_at: string;
  last_used_at: string;
  device: UserAgentDescription;
  ip: string | null;
  current: boolean;
}

export function toPublicSession(row: SessionListRow): PublicSession {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    last_used_at: row.last_used_at.toISOString(),
    device: describeUserAgent(row.user_agent),
    ip: row.ip,
    current: row.current,
  };
}
