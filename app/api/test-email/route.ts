import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { sendTestEmail } from "@/lib/email";
import { getSettings } from "@/lib/settings";

export async function POST() {
  try {
    const settings = await getSettings();
    if (!settings.alert_email_to) {
      return badRequest("alert_email_to is not set. Save an alert email first.");
    }
    const id = await sendTestEmail(settings.alert_email_to);
    return NextResponse.json({ ok: true, to: settings.alert_email_to, id });
  } catch (err) {
    return errorResponse(err);
  }
}
