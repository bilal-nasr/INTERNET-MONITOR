import type { SettingsRow } from "@/lib/settings";

/**
 * What a fresh install still needs before the first reading can arrive and
 * the first alert can go out. Computed on the server from env and settings;
 * the router push itself is "done" the moment a reading exists, at which
 * point the dashboard stops showing the checklist at all.
 */
export interface SetupStatus {
  database: true;
  emailKey: boolean;
  alertAddress: boolean;
  secret: boolean;
  interfaceName: string;
}

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * `env` is the plain shape of `process.env` rather than `NodeJS.ProcessEnv`:
 * Next.js augments that type with a required `NODE_ENV`, which a test calling
 * this with a two-key object literal cannot satisfy. `process.env` is
 * assignable to this, so the only caller is unaffected.
 */
export function setupStatus(
  settings: SettingsRow,
  env: Record<string, string | undefined>,
): SetupStatus {
  return {
    database: true,
    emailKey: present(env.RESEND_API_KEY),
    alertAddress: present(settings.alert_email_to ?? undefined),
    secret: present(env.CRON_SECRET),
    interfaceName: settings.wan_interface_name,
  };
}
