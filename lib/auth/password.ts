/**
 * Password hashing, with nothing but node:crypto.
 *
 * scrypt is memory-hard and ships with Node, so there is no native module to
 * build in the Docker image and no dependency to audit. A hash is stored as
 * `scrypt$N$r$p$salt$hash`, all parameters included, so the cost can be raised
 * later and old rows still verify.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 };

function options(N: number, r: number, p: number) {
  // Node rejects a run that would need more than maxmem; 128*N*r is the exact
  // requirement, so leave headroom rather than fail on the default settings.
  return { N, r, p, maxmem: 256 * N * r };
}

export async function hashPassword(password: string, salt = randomBytes(16)): Promise<string> {
  const { N, r, p } = DEFAULT_PARAMS;
  const derived = await scrypt(password, salt, KEY_LENGTH, options(N, r, p));
  return ["scrypt", N, r, p, salt.toString("base64"), derived.toString("base64")].join("$");
}

/** False for a malformed stored hash rather than a throw: the row is wrong, the caller is not. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every((v) => Number.isInteger(v) && v > 0)) return false;

  const expected = Buffer.from(hashB64, "base64");
  if (expected.length === 0) return false;
  try {
    const derived = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, options(N, R, P));
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
