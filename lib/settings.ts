import { db } from "@/lib/db";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";

export interface SettingsRow {
  id: number;
  quota_gb: number;
  monthly_quota_gb: number;
  billing_cycle_day: number;
  window_start: string; // "HH:MM:SS" from Postgres TIME
  window_end: string;
  timezone: string;
  alert_email_to: string | null;
  wan_interface_name: string;
  polling_enabled: boolean;
  /** Language quota alerts are written in. See `alertLocale`. */
  language: string;
  updated_at: Date;
}

/**
 * The stored language, narrowed.
 *
 * The column is TEXT with a CHECK, so the database will not hold anything else,
 * but a row written before a language was dropped from the application still
 * could. Falling back keeps an alert going out in English rather than not at all.
 */
export function alertLocale(row: SettingsRow): Locale {
  return isLocale(row.language) ? row.language : DEFAULT_LOCALE;
}

/** Shape returned to the browser. */
export interface PublicSettings {
  quota_gb: number;
  monthly_quota_gb: number;
  billing_cycle_day: number;
  window_start: string; // "HH:MM"
  window_end: string;
  timezone: string;
  alert_email_to: string | null;
  wan_interface_name: string;
  polling_enabled: boolean;
  language: string;
  updated_at: string;
}

export type SettingsPatch = Partial<
  Pick<
    SettingsRow,
    | "quota_gb"
    | "monthly_quota_gb"
    | "billing_cycle_day"
    | "window_start"
    | "window_end"
    | "timezone"
    | "alert_email_to"
    | "wan_interface_name"
    | "polling_enabled"
    | "language"
  >
>;

export class SettingsNotSeededError extends Error {
  constructor() {
    super("settings table has no row with id=1. Run schema.sql to seed it.");
    this.name = "SettingsNotSeededError";
  }
}

export async function getSettings(): Promise<SettingsRow> {
  const row = await db.oneOrNone<SettingsRow>(
    `SELECT id, quota_gb, monthly_quota_gb, billing_cycle_day, window_start,
            window_end, timezone, alert_email_to, wan_interface_name,
            polling_enabled, language, updated_at
     FROM settings WHERE id = 1`,
  );
  if (!row) throw new SettingsNotSeededError();
  return row;
}

export function toPublicSettings(row: SettingsRow): PublicSettings {
  return {
    quota_gb: row.quota_gb,
    monthly_quota_gb: row.monthly_quota_gb,
    billing_cycle_day: row.billing_cycle_day,
    window_start: row.window_start.slice(0, 5),
    window_end: row.window_end.slice(0, 5),
    timezone: row.timezone,
    alert_email_to: row.alert_email_to,
    wan_interface_name: row.wan_interface_name,
    polling_enabled: row.polling_enabled,
    language: row.language,
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Upsert the single settings row. Only the keys present in `patch` are written;
 * any missing key keeps its current value (or the schema default on insert).
 */
/** Column names are interpolated into SQL, so they are checked at runtime, not just by types. */
const WRITABLE = new Set<string>([
  "quota_gb",
  "monthly_quota_gb",
  "billing_cycle_day",
  "window_start",
  "window_end",
  "timezone",
  "alert_email_to",
  "wan_interface_name",
  "polling_enabled",
  "language",
]);

export async function updateSettings(patch: SettingsPatch): Promise<SettingsRow> {
  const columns = Object.keys(patch) as (keyof SettingsPatch)[];
  for (const c of columns) {
    if (!WRITABLE.has(c)) throw new Error(`refusing to write unknown settings column: ${String(c)}`);
  }
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
