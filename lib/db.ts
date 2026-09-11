import pgPromise, { type IDatabase } from "pg-promise";
import { SUPABASE_ROOT_2021_CA } from "@/lib/certs";

// Parse Postgres numeric types into JS numbers. Byte counters on a home link
// stay far below Number.MAX_SAFE_INTEGER (9e15, roughly 9 PB).
const pgp = pgPromise();
pgp.pg.types.setTypeParser(20, (v) => Number(v)); // BIGINT
pgp.pg.types.setTypeParser(1700, (v) => Number(v)); // NUMERIC
pgp.pg.types.setTypeParser(1082, (v) => v); // DATE -> 'YYYY-MM-DD' string

type Db = IDatabase<object>;

function createDb(): Db {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return pgp({
    connectionString,
    ssl: sslConfig(connectionString),
    max: 5,
  });
}

/**
 * TLS settings for the database connection.
 *  - local host or DATABASE_SSL=disable: no TLS
 *  - DATABASE_SSL=no-verify: encrypt but skip certificate verification
 *  - DATABASE_SSL_CA=supabase: verify against the bundled Supabase root CA
 *    (Supabase's pooler is signed by a private CA that Node does not trust)
 *  - DATABASE_SSL_CA=<PEM>: verify against that CA (inline, "\n"-escaped ok)
 *  - otherwise: verify against the system CA store (works for Neon)
 * A ?sslmode= parameter inside DATABASE_URL takes precedence over all of this.
 */
function sslConfig(connectionString: string): false | { rejectUnauthorized: boolean; ca?: string } {
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  if (isLocal || process.env.DATABASE_SSL === "disable") return false;
  if (process.env.DATABASE_SSL === "no-verify") return { rejectUnauthorized: false };

  const raw = process.env.DATABASE_SSL_CA?.trim();
  if (!raw) return { rejectUnauthorized: true };
  const ca = raw === "supabase" ? SUPABASE_ROOT_2021_CA : raw.replace(/\\n/g, "\n");
  return { rejectUnauthorized: true, ca };
}

// One pool per process, created on first query (not at import time, so
// `next build` works without DATABASE_URL) and reused across hot reloads.
const globalForDb = globalThis as unknown as { __quotaDb?: Db };

function getDb(): Db {
  if (!globalForDb.__quotaDb) {
    globalForDb.__quotaDb = createDb();
  }
  return globalForDb.__quotaDb;
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const instance = getDb();
    const value = Reflect.get(instance, prop) as unknown;
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(instance) : value;
  },
});

export { pgp };
