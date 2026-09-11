import { Resend } from "resend";
import { formatBytes } from "@/lib/format";

export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailError";
  }
}

function getClient(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new EmailError("RESEND_API_KEY is not set");
  return new Resend(key);
}

function fromAddress(): string {
  return process.env.ALERT_EMAIL_FROM || "Quota Monitor <onboarding@resend.dev>";
}

async function send(to: string, subject: string, text: string, html: string): Promise<string> {
  const { data, error } = await getClient().emails.send({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
  if (error) throw new EmailError(`Resend error: ${error.message}`);
  return data?.id ?? "";
}

export interface QuotaAlertInput {
  to: string;
  date: string;
  usedBytes: number;
  quotaBytes: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
}

export function sendQuotaAlert(input: QuotaAlertInput): Promise<string> {
  const used = formatBytes(input.usedBytes);
  const quota = formatBytes(input.quotaBytes);
  const pct = Math.round((input.usedBytes / input.quotaBytes) * 100);
  const subject = `Internet quota exceeded: ${used} of ${quota} used (${input.date})`;
  const text = [
    `Your home internet usage has exceeded the daily quota.`,
    ``,
    `Date:   ${input.date}`,
    `Window: ${input.windowStart}-${input.windowEnd} (${input.timezone})`,
    `Used:   ${used} (${pct}% of ${quota})`,
    ``,
    `This is the only alert you will receive for today.`,
  ].join("\n");
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">
      <h2 style="margin:0 0 12px">Internet quota exceeded</h2>
      <p style="margin:0 0 16px;color:#444">Your home internet usage has exceeded the daily quota.</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Date</td><td>${input.date}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Window</td><td>${input.windowStart}-${input.windowEnd} (${input.timezone})</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Used</td><td><strong>${used}</strong> (${pct}% of ${quota})</td></tr>
      </table>
      <p style="margin:16px 0 0;color:#888;font-size:12px">This is the only alert you will receive for today.</p>
    </div>`;
  return send(input.to, subject, text, html);
}

export function sendTestEmail(to: string): Promise<string> {
  const now = new Date().toISOString();
  return send(
    to,
    "Test alert from MikroTik quota monitor",
    `This is a test email sent at ${now}. Alerts are working.`,
    `<p style="font-family:system-ui,sans-serif">This is a test email sent at <code>${now}</code>. Alerts are working.</p>`,
  );
}
