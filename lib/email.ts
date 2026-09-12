import { Resend } from "resend";
import { DIRECTION, type Locale } from "@/lib/i18n/config";
import { fill, getDictionaryFor } from "@/lib/i18n";
import { renderAlertEmail, type AlertReport, type RenderedEmail } from "@/lib/email-template";

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
 * Send an already-rendered message. Every alert goes through here, so the
 * dispatcher can record exactly the subject that went out.
 */
export function sendRendered(to: string, email: RenderedEmail): Promise<string> {
  return send(to, email.subject, email.text, email.html);
}

/**
 * The real over-quota alert and the settings page's test send share this;
 * `report.kind` tells them apart, which is why the test mail is a true preview
 * rather than a separate template that can drift out of step.
 */
export function sendAlertEmail(to: string, report: AlertReport): Promise<string> {
  return sendRendered(to, renderAlertEmail(report));
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
