import { db, pgp } from "@/lib/db";
import type { DevicePush } from "@/lib/devices/parse";

/** Column set for the multi-row insert; built once, pg-promise caches it. */
const READING_COLUMNS = new pgp.helpers.ColumnSet(["recorded_at", "mac", "tx_bytes", "rx_bytes"], {
  table: "device_readings",
});

/**
 * One transaction per push: every device row is upserted, then every reading
 * is inserted in a single statement. A push of two hundred devices is then two
 * round trips plus the upserts rather than four hundred inserts, which matters
 * at eighty-five milliseconds per trip to the database.
 *
 * `name` is never written here: it belongs to the owner, who sets it on the
 * Devices page. The router only ever refreshes `hostname`, `ip` and `last_seen`.
 */
export async function storeDevicePush(
  push: DevicePush,
  now = new Date(),
): Promise<{ devices: number; readings: number }> {
  return db.tx(async (t) => {
    for (const device of push.devices) {
      await t.none(
        `INSERT INTO devices (mac, hostname, ip, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (mac) DO UPDATE
           SET hostname  = COALESCE(EXCLUDED.hostname, devices.hostname),
               ip        = COALESCE(EXCLUDED.ip, devices.ip),
               last_seen = EXCLUDED.last_seen`,
        [device.mac, device.name, device.ip, now],
      );
    }
    const rows = push.devices.map((d) => ({
      recorded_at: now,
      mac: d.mac,
      tx_bytes: d.tx_bytes,
      rx_bytes: d.rx_bytes,
    }));
    await t.none(pgp.helpers.insert(rows, READING_COLUMNS));
    return { devices: push.devices.length, readings: rows.length };
  });
}
