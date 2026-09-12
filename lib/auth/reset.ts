/**
 * "Forgot password": a single-use link that lasts an hour.
 *
 * The token in the link is stored hashed, like a session token, and consuming
 * it also signs every browser out, since whoever asked for the reset no longer
 * trusts the old password.
 */

import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { generateToken, hashToken, looksLikeToken } from "@/lib/auth/tokens";

export const RESET_TTL_SECONDS = 60 * 60;

export async function createPasswordReset(userId: number, now = new Date()): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + RESET_TTL_SECONDS * 1000);
  await db.tx(async (t) => {
    // One outstanding link per account: asking twice invalidates the first.
    await t.none(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [
      userId,
    ]);
    await t.none(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
      userId,
      hashToken(token),
      expiresAt,
    ]);
  });
  return token;
}

/** True when the token was live and the password is now changed. */
export async function consumePasswordReset(
  token: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!looksLikeToken(token)) return false;
  const password_hash = await hashPassword(password);
  return db.tx(async (t) => {
    const row = await t.oneOrNone<{ user_id: number }>(
      `UPDATE password_resets SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [hashToken(token)],
    );
    if (!row) return false;
    await t.none(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
      row.user_id,
      password_hash,
    ]);
    await t.none(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
      row.user_id,
    ]);
    return true;
  });
}
