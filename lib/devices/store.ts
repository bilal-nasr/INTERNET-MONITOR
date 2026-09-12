import { db, pgp } from "@/lib/db";
import type { DevicePush } from "@/lib/devices/parse";

/**
 * How many rows `devices` may ever hold.
 *
 * A home LAN has tens of devices. The ingest route, though, creates a row for
 * any MAC the caller names, and phones that randomise their MAC on every join
 * name a new one every time, so without a ceiling the table grows for ever and
 * the "Devices seen" tile counts ghosts. Once the table is full, known devices
 * keep updating normally and only unknown ones are turned away; the thinning
 * job frees room again by pruning devices that have not been heard from since
 * the retention cutoff (see lib/retention.ts).
 */
export const MAX_TRACKED_DEVICES = 1000;

/** Column set for the multi-row insert; built once, pg-promise caches it. */
const READING_COLUMNS = new pgp.helpers.ColumnSet(["recorded_at", "mac", "tx_bytes", "rx_bytes"], {
  table: "device_readings",
});

interface DeviceRow {
  mac: string;
  hostname: string | null;
  ip: string | null;
  first_seen: Date;
  last_seen: Date;
}

/**
 * Casts on every column: these values become a VALUES list inside a CTE, where
 * an untyped literal would be text and a batch of all-null hostnames would
 * have no type at all.
 */
const DEVICE_COLUMNS = new pgp.helpers.ColumnSet<DeviceRow>(
  [
    { name: "mac", cast: "text" },
    { name: "hostname", cast: "text" },
    { name: "ip", cast: "text" },
    { name: "first_seen", cast: "timestamptz" },
    { name: "last_seen", cast: "timestamptz" },
  ],
  { table: "devices" },
);

/**
 * One transaction per push, two round trips: every device is upserted by a
 * single multi-row statement, then every reading is inserted by another.
 *
 * The upsert used to be one statement per device. At the batch size the router
 * sends (200) and eighty-five milliseconds to the database, that held a
 * transaction and one of the pool's ten connections for about seventeen
 * seconds of every minute, competing with page rendering for both.
 *
 * `name` is never written here: it belongs to the owner, who sets it on the
 * Devices page. The router only ever refreshes `hostname`, `ip` and `last_seen`.
 *
 * Nothing is bound as a parameter. The row values are already finished SQL
 * literals inside `values`, and a second formatting pass over the statement
 * would go looking for variables inside them -- a hostname containing `$1` is
 * a string the device chose, not something to interpolate.
 */
export async function storeDevicePush(
  push: DevicePush,
  now = new Date(),
): Promise<{ devices: number; readings: number; dropped: number }> {
  const rows: DeviceRow[] = push.devices.map((d) => ({
    mac: d.mac,
    hostname: d.name,
    ip: d.ip,
    first_seen: now,
    last_seen: now,
  }));
  const values = pgp.helpers.values(rows, DEVICE_COLUMNS);
  const cap = pgp.as.number(MAX_TRACKED_DEVICES);

  return db.tx(async (t) => {
    // `allowed` is every incoming device the table already knows, plus as many
    // of the unknown ones as there is room for. Ordering the newcomers by MAC
    // makes which ones get in deterministic rather than dependent on the order
    // the router happened to list them.
    const upserted = await t.any<{ mac: string }>(
      `WITH incoming (mac, hostname, ip, first_seen, last_seen) AS (VALUES ${values}),
       room AS (
         SELECT GREATEST(${cap} - (SELECT COUNT(*) FROM devices), 0) AS n
       ),
       fresh AS (
         SELECT i.*, ROW_NUMBER() OVER (ORDER BY i.mac) AS rn
         FROM incoming i
         WHERE NOT EXISTS (SELECT 1 FROM devices d WHERE d.mac = i.mac)
       ),
       allowed AS (
         SELECT i.mac, i.hostname, i.ip, i.first_seen, i.last_seen
         FROM incoming i
         WHERE EXISTS (SELECT 1 FROM devices d WHERE d.mac = i.mac)
         UNION ALL
         SELECT f.mac, f.hostname, f.ip, f.first_seen, f.last_seen
         FROM fresh f, room
         WHERE f.rn <= room.n
       )
       INSERT INTO devices (mac, hostname, ip, first_seen, last_seen)
       SELECT mac, hostname, ip, first_seen, last_seen FROM allowed
       ON CONFLICT (mac) DO UPDATE
         SET hostname  = COALESCE(EXCLUDED.hostname, devices.hostname),
             ip        = COALESCE(EXCLUDED.ip, devices.ip),
             last_seen = EXCLUDED.last_seen
       RETURNING mac`,
    );

    // Readings are written only for devices that actually have a row:
    // device_readings.mac is a foreign key, so a reading for a device the cap
    // turned away would fail the whole push.
    const stored = new Set(upserted.map((r) => r.mac));
    const readings = push.devices
      .filter((d) => stored.has(d.mac))
      .map((d) => ({ recorded_at: now, mac: d.mac, tx_bytes: d.tx_bytes, rx_bytes: d.rx_bytes }));
    if (readings.length > 0) {
      await t.none(pgp.helpers.insert(readings, READING_COLUMNS));
    }

    return {
      devices: stored.size,
      readings: readings.length,
      dropped: push.devices.length - stored.size,
    };
  });
}
