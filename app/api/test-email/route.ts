import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { sendAlertEmail } from "@/lib/email";
import { buildAlertReport, sampleAlertReport } from "@/lib/email-report";
import { renderAlertEmail, type AlertReport } from "@/lib/email-template";
import { alertLocale, getSettings, type SettingsRow } from "@/lib/settings";
import { getTodayUsage } from "@/lib/usage";

/**
 * The test send renders the real alert from today's live figures, so pressing
 * the button on /settings shows exactly what a breach would look like rather
 * than a one-line message that proves only that Resend is reachable.
 */
async function liveTestReport(settings: SettingsRow, now = new Date()): Promise<AlertReport> {
  const today = await getTodayUsage(settings, now);
  return buildAlertReport({
    settings,
    kind: "test",
    date: today.date,
    usedBytes: today.used_since_baseline,
    quotaBytes: today.quota_bytes,
    now,
  });
}

export async function POST(request: Request) {
  const d = dictionaryFromRequest(request);
  try {
    const settings = await getSettings();
    if (!settings.alert_email_to) {
      return badRequest(d.errors.alertEmailMissing);
    }
    const report = await liveTestReport(settings);
    const id = await sendAlertEmail(settings.alert_email_to, report);
    return NextResponse.json({ ok: true, to: settings.alert_email_to, id });
  } catch (err) {
    return errorResponse(err, d);
  }
}

/**
 * Renders the email in the browser instead of sending it. Nothing is delivered
 * and no alert state is touched, which makes it the way to iterate on the
 * template. `?sample=1` uses a fixture, for a deployment with no readings yet.
 */
export async function GET(request: Request) {
  try {
    const wantsSample = new URL(request.url).searchParams.get("sample") === "1";
    // The preview follows the saved alert language, not the language of the
    // page that opened it: the point is to see the mail as it will be sent.
    const settings = await getSettings();
    const report = wantsSample
      ? sampleAlertReport(new Date(), alertLocale(settings))
      : await liveTestReport(settings);
    return new NextResponse(renderAlertEmail(report).html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
