import { db } from "@/lib/db";

export interface SettingsRow {
  id: number;
  quota_gb: number;
  window_start: string; // "HH:MM:SS" from Postgres TIME
  window_end: string;
  timezone: string;
  alert_email_to: string | null;
  wan_interface_name: string;
  router_host: string | null;
  router_user: string | null;
  router_pass: string | null;
  polling_enabled: boolean;
  updated_at: Date;
}

/** Shape returned to the browser: never includes the router password. */
export interface PublicSettings {
  quota_gb: number;
  window_start: string; // "HH:MM"
  window_end: string;
  timezone: string;
  alert_email_to: string | null;
  wan_interface_name: string;
  router_host: string | null;
  router_user: string | null;
  has_password_set: boolean;
  polling_enabled: boolean;
  updated_at: string;
}

export type SettingsPatch = Partial<
  Pick<
    SettingsRow,
    | "quota_gb"
    | "window_start"
    | "window_end"
    | "timezone"
    | "alert_email_to"
    | "wan_interface_name"
    | "router_host"
    | "router_user"
    | "router_pass"
    | "polling_enabled"
  >
>;

export class SettingsNotSeededError extends Error {
  constructor() {
    super("settings table has no row with id=1. Run schema.sql to seed it.");
    this.name = "SettingsNotSeededError";
  }
}

export async function getSettings(): Promise<SettingsRow> {
  const row = await db.oneOrNone<SettingsRow>("SELECT * FROM settings WHERE id = 1");
  if (!row) throw new SettingsNotSeededError();
  return row;
}

export function toPublicSettings(row: SettingsRow): PublicSettings {
  return {
    quota_gb: row.quota_gb,
    window_start: row.window_start.slice(0, 5),
    window_end: row.window_end.slice(0, 5),
    timezone: row.timezone,
    alert_email_to: row.alert_email_to,
    wan_interface_name: row.wan_interface_name,
    router_host: row.router_host,
    router_user: row.router_user,
    has_password_set: Boolean(row.router_pass),
    polling_enabled: row.polling_enabled,
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Upsert the single settings row. Only the keys present in `patch` are written;
 * any missing key keeps its current value (or the schema default on insert).
 */
export async function updateSettings(patch: SettingsPatch): Promise<SettingsRow> {
  const columns = Object.keys(patch) as (keyof SettingsPatch)[];
  if (columns.length === 0) return getSettings();

  const insertCols = ["id", ...columns].map((c) => `"${c}"`).join(", ");
  const insertVals = ["1", ...columns.map((c) => `$\{${c}\}`)].join(", ");
  const updates = [...columns.map((c) => `"${c}" = EXCLUDED."${c}"`), "updated_at = now()"].join(", ");

  return db.one<SettingsRow>(
    `INSERT INTO settings (${insertCols}) VALUES (${insertVals})
     ON CONFLICT (id) DO UPDATE SET ${updates}
     RETURNING *`,
    patch,
  );
}
