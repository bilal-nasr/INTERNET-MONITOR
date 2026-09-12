import { Resend } from "resend";
import { formatBytes } from "@/lib/format";
import { DIRECTION, type Locale } from "@/lib/i18n/config";
import { fill, getDictionaryFor } from "@/lib/i18n";
import { renderAlertEmail, type AlertReport } from "@/lib/email-template";

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

/**
 * An alert is sent with no request behind it, so its language comes from the
 * stored setting rather than from a header. The mail client has no stylesheet
 * of ours either, so direction is set on the element itself: without it an
 * Arabic alert would be laid out left to right by whatever is reading it.
 */
function shell(locale: Locale, body: string): string {
  const dir = DIRECTION[locale];
  const align = dir === "rtl" ? "right" : "left";
  return `
    <div dir="${dir}" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;text-align:${align}">
      ${body}
    </div>`;
}

export interface QuotaAlertInput {
  to: string;
  locale: Locale;
  date: string;
  usedBytes: number;
  quotaBytes: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
}

export function sendQuotaAlert(input: QuotaAlertInput): Promise<string> {
  const d = getDictionaryFor(input.locale).email;
  const used = formatBytes(input.usedBytes);
  const quota = formatBytes(input.quotaBytes);
  const percent = Math.round((input.usedBytes / input.quotaBytes) * 100);

  const subject = fill(d.alertSubject, { used, quota, date: input.date });
  const window = `${input.windowStart}-${input.windowEnd} (${input.timezone})`;
  const usedValue = fill(d.usedValue, { used, percent, quota });

  const text = [
    d.alertIntro,
    ``,
    `${d.date}: ${input.date}`,
    `${d.window}: ${window}`,
    `${d.used}: ${usedValue}`,
    ``,
    d.onlyAlert,
  ].join("\n");

  const pad = "padding:4px 12px";
  const html = shell(
    input.locale,
    `<h2 style="margin:0 0 12px">${d.alertHeading}</h2>
      <p style="margin:0 0 16px;color:#444">${d.alertIntro}</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="${pad};color:#666">${d.date}</td><td>${input.date}</td></tr>
        <tr><td style="${pad};color:#666">${d.window}</td><td>${window}</td></tr>
        <tr><td style="${pad};color:#666">${d.used}</td><td>${fill(d.usedValue, {
          used: `<strong>${used}</strong>`,
          percent,
          quota,
        })}</td></tr>
      </table>
      <p style="margin:16px 0 0;color:#888;font-size:12px">${d.onlyAlert}</p>`,
  );

  return send(input.to, subject, text, html);
}

export function sendTestEmail(to: string, locale: Locale): Promise<string> {
  const d = getDictionaryFor(locale).email;
  const now = new Date().toISOString();
  const body = fill(d.testBody, { time: now });
  return send(
    to,
    d.testSubject,
    body,
    shell(locale, `<p>${fill(d.testBody, { time: `<code>${now}</code>` })}</p>`),
  );
}

/**
 * Send a rendered report. The same function serves the real over-quota alert
 * and the settings page's test send; `report.kind` is what tells them apart,
 * which is why the test mail is a true preview rather than a separate template
 * that can drift out of step with the one that matters.
 *
 * NOTE: this template is English-only and does not yet go through the i18n
 * dictionaries that sendQuotaAlert below uses. The two need reconciling.
 */
export function sendAlertEmail(to: string, report: AlertReport): Promise<string> {
  const { subject, text, html } = renderAlertEmail(report);
  return send(to, subject, text, html);
}

/**
 * The "forgot password" link. The language is the one the request was made
 * in: unlike an alert there is a person on the other end of this request, and
 * the page they are reading is the best guess at how they want to be written to.
 */
export function sendPasswordResetEmail(to: string, locale: Locale, username: string, link: string): Promise<string> {
  const d = getDictionaryFor(locale).auth.email;
  const intro = fill(d.resetIntro, { username });
  const text = [intro, ``, link, ``, d.resetIgnore].join("\n");
  const html = shell(
    locale,
    `<p style="margin:0 0 16px">${fill(d.resetIntro, { username: `<strong>${escapeHtml(username)}</strong>` })}</p>
      <p style="margin:0 0 16px">
        <a href="${link}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">${d.resetButton}</a>
      </p>
      <p style="margin:0 0 16px;font-size:12px;color:#666;word-break:break-all">${link}</p>
      <p style="margin:0;color:#888;font-size:12px">${d.resetIgnore}</p>`,
  );
  return send(to, d.resetSubject, text, html);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
