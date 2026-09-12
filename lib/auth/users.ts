import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

/** What the browser is allowed to know about the signed-in account. */
export interface PublicUser {
  id: number;
  username: string;
  email: string | null;
}

export function toPublicUser(row: Pick<UserRow, "id" | "username" | "email">): PublicUser {
  return { id: row.id, username: row.username, email: row.email };
}

const COLUMNS = "id, username, email, password_hash, created_at, updated_at";

/** Usernames are compared case-insensitively; the stored spelling is what is shown. */
export function findUserByUsername(username: string): Promise<UserRow | null> {
  return db.oneOrNone<UserRow>(`SELECT ${COLUMNS} FROM users WHERE lower(username) = lower($1)`, [
    username.trim(),
  ]);
}

export function findUserById(id: number): Promise<UserRow | null> {
  return db.oneOrNone<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
}

/**
 * A hash of nothing in particular, verified against when the username does not
 * exist, so a wrong username costs the same time as a wrong password and the
 * response time does not say which one it was.
 */
const DECOY_HASH_PROMISE = hashPassword("decoy");

export async function verifyCredentials(username: string, password: string): Promise<PublicUser | null> {
  const user = await findUserByUsername(username);
  if (!user) {
    await verifyPassword(password, await DECOY_HASH_PROMISE);
    return null;
  }
  const ok = await verifyPassword(password, user.password_hash);
  return ok ? toPublicUser(user) : null;
}

export async function updatePassword(userId: number, password: string): Promise<void> {
  const password_hash = await hashPassword(password);
  await db.none(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
    userId,
    password_hash,
  ]);
}

export async function updateEmail(userId: number, email: string | null): Promise<PublicUser> {
  return db.one<PublicUser>(
    `UPDATE users SET email = $2, updated_at = now() WHERE id = $1 RETURNING id, username, email`,
    [userId, email],
  );
}
