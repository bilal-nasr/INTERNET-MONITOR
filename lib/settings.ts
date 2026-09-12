import { db } from "@/lib/db";
import { memoized } from "@/lib/memo";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";

/** Which scheduled summary is sent. See lib/cron/digest.ts. */
export type DigestKind = "off" | "weekly" | "cycle";
export const DIGEST_KINDS: readonly DigestKind[] = ["off", "weekly", "cycle"];

export function isDigestKind(value: string): value is DigestKind {
  return (DIGEST_KINDS as readonly string[]).includes(value);
}

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
  /** Answer the push with throttle=true while the daily quota is exceeded inside the window. */
  throttle_on_breach: boolean;
  /** Answer the push with throttle=true while the monthly cap is exceeded. */
  throttle_on_cap: boolean;
  /** Whether device pushes are stored and the Devices page is shown. */
  devices_enabled: boolean;
  /** Minutes without a push before the link_stale alert. 0 disables it. */
  stale_after_minutes: number;
  digest: DigestKind;
  /** Percent marks of the daily quota that trigger a mail. Ascending, 1..100. */
  alert_thresholds: number[];
  /** Percent marks of the monthly cap that trigger a mail. */
  cycle_alert_thresholds: number[];
  /** One mail per cycle when the projection first crosses the cap. */
  cycle_pace_alert: boolean;
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
  throttle_on_breach: boolean;
  throttle_on_cap: boolean;
  devices_enabled: boolean;
  stale_after_minutes: number;
  digest: string;
  alert_thresholds: number[];
  cycle_alert_thresholds: number[];
  cycle_pace_alert: boolean;
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
    | "throttle_on_breach"
    | "throttle_on_cap"
    | "devices_enabled"
    | "stale_after_minutes"
    | "digest"
    | "alert_thresholds"
    | "cycle_alert_thresholds"
    | "cycle_pace_alert"
  >
>;

export class SettingsNotSeededError extends Error {
  constructor() {
    super("settings table has no row with id=1. Run schema.sql to seed it.");
    this.name = "SettingsNotSeededError";
  }
}

/**
 * The row is read by every page and every API call and written only from the
 * settings form, so it is kept in memory between requests. A save in this
 * process drops the copy at once; a save made elsewhere (another container
 * behind the same database) shows up within the ttl.
 */
const SETTINGS_TTL_MS = 30_000;

const cached = memoized(loadSettings, SETTINGS_TTL_MS);

export function getSettings(): Promise<SettingsRow> {
  return cached.get();
}

async function loadSettings(): Promise<SettingsRow> {
  const row = await db.oneOrNone<SettingsRow>(
    `SELECT id, quota_gb, monthly_quota_gb, billing_cycle_day, window_start,
            window_end, timezone, alert_email_to, wan_interface_name,
            polling_enabled, language, alert_thresholds, cycle_alert_thresholds,
            cycle_pace_alert, stale_after_minutes, digest,
            throttle_on_breach, throttle_on_cap, updated_at
            cycle_pace_alert, stale_after_minutes, digest, devices_enabled,
            updated_at
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
    throttle_on_breach: row.throttle_on_breach,
    throttle_on_cap: row.throttle_on_cap,
    devices_enabled: row.devices_enabled,
    stale_after_minutes: row.stale_after_minutes,
    digest: row.digest,
    alert_thresholds: row.alert_thresholds,
    cycle_alert_thresholds: row.cycle_alert_thresholds,
    cycle_pace_alert: row.cycle_pace_alert,
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
  "throttle_on_breach",
  "throttle_on_cap",
  "devices_enabled",
  "stale_after_minutes",
  "digest",
  "alert_thresholds",
  "cycle_alert_thresholds",
  "cycle_pace_alert",
]);

export async function updateSettings(patch: SettingsPatch): Promise<SettingsRow> {
  const columns = Object.keys(patch) as (keyof SettingsPatch)[];
  for (const c of columns) {
    if (!WRITABLE.has(c)) throw new Error(`refusing to write unknown settings column: ${String(c)}`);
  }
  if (columns.length === 0) return getSettings();
  cached.invalidate();

  const insertCols = ["id", ...columns].map((c) => `"${c}"`).join(", ");
  const insertVals = ["1", ...columns.map((c) => `$\{${c}\}`)].join(", ");
  const updates = [...columns.map((c) => `"${c}" = EXCLUDED."${c}"`), "updated_at = now()"].join(", ");

  const row = await db.one<SettingsRow>(
    `INSERT INTO settings (${insertCols}) VALUES (${insertVals})
     ON CONFLICT (id) DO UPDATE SET ${updates}
     RETURNING *`,
    patch,
  );
  // A read that raced the write may have refilled the cache with the old row.
  cached.invalidate();
  return row;
}
