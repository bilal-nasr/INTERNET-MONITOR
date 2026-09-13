/**
 * The settings page's tabs, in display order. The page reads `?tab=` against
 * this list, so a link can open a tab directly (`/settings?tab=router`).
 */
export const SETTINGS_TABS = ["limits", "alerts", "router", "data", "appearance", "account"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === "string" && (SETTINGS_TABS as readonly string[]).includes(value);
}
