import { describe, expect, test } from "vitest";
import { setupStatus } from "@/lib/setup-status";
import type { SettingsRow } from "@/lib/settings";

const settings = {
  alert_email_to: null,
  wan_interface_name: "pppoe-out1",
} as unknown as SettingsRow;

describe("setupStatus", () => {
  test("reports each missing piece separately", () => {
    expect(setupStatus(settings, {})).toEqual({
      database: true,
      emailKey: false,
      alertAddress: false,
      secret: false,
      interfaceName: "pppoe-out1",
    });
  });

  test("treats a blank env value as missing", () => {
    expect(setupStatus(settings, { RESEND_API_KEY: "  ", CRON_SECRET: "" }).emailKey).toBe(false);
    expect(setupStatus(settings, { RESEND_API_KEY: "  ", CRON_SECRET: "" }).secret).toBe(false);
  });

  test("is complete when everything is set", () => {
    const s = setupStatus(
      { ...settings, alert_email_to: "a@b.c" },
      { RESEND_API_KEY: "re_x", CRON_SECRET: "s" },
    );
    expect(s).toEqual({ database: true, emailKey: true, alertAddress: true, secret: true, interfaceName: "pppoe-out1" });
  });
});
