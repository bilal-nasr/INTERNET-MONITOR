import { db } from "@/lib/db";
import type { RouterAddress } from "@/lib/router/address";

/**
 * Called by /api/ingest on every push. Never throws: the address is a
 * convenience, and the reading in the same push is what matters.
 * Only ever forwards, so a retried or overtaken push cannot bring back an
 * address the router has since moved off.
 */
export async function recordRouterAddress(
  wanIp: string | null,
  publicIp: string | null,
  at: Date,
): Promise<void> {
  if (!wanIp && !publicIp) return;
  try {
    await db.none(
      `INSERT INTO router_address (id, wan_ip, public_ip, changed_at, seen_at) VALUES (1, $1, $2, $3, $3)
       ON CONFLICT (id) DO UPDATE SET
         wan_ip = EXCLUDED.wan_ip,
         public_ip = EXCLUDED.public_ip,
         seen_at = EXCLUDED.seen_at,
         changed_at = CASE
           WHEN router_address.wan_ip IS DISTINCT FROM EXCLUDED.wan_ip
             OR router_address.public_ip IS DISTINCT FROM EXCLUDED.public_ip
           THEN EXCLUDED.seen_at
           ELSE router_address.changed_at
         END
       WHERE router_address.seen_at < EXCLUDED.seen_at`,
      [wanIp, publicIp, at],
    );
  } catch (err) {
    console.warn("[ingest] could not record the router address", err);
  }
}

export async function getRouterAddress(): Promise<RouterAddress | null> {
  const row = await db.oneOrNone<{ wan_ip: string | null; public_ip: string | null; changed_at: Date; seen_at: Date }>(
    "SELECT wan_ip, public_ip, changed_at, seen_at FROM router_address WHERE id = 1",
  );
  if (!row) return null;
  return {
    wan_ip: row.wan_ip,
    public_ip: row.public_ip,
    changed_at: row.changed_at.toISOString(),
    seen_at: row.seen_at.toISOString(),
  };
}
