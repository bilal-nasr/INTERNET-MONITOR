/**
 * The mail sent when the router stops pushing, and its all-clear.
 *
 * Pure, like lib/email-template.ts and lib/email-cycle-template.ts: a report
 * in, subject/text/html out. No database, no network, no clock. Short enough
 * to be inline-styled by hand, following the cap mail's simpler structure
 * (a card of key/value rows, no bar chart) rather than the daily alert's
 * nested-table layout - there is one fact to report here, not a dashboard's
 * worth of them.
 */

import type { RenderedEmail } from "@/lib/email-template";
import { escapeHtml as esc } from "@/lib/format";
import { fill, getDictionaryFor } from "@/lib/i18n";
import { DIRECTION, type Locale } from "@/lib/i18n/config";
import { makeFormatters } from "@/lib/i18n/format";
import { segmentSeconds, type CauseSegment } from "@/lib/outage-cause";
import { formatDuration, isValidTimeZone } from "@/lib/time";

export interface LinkReport {
  /** A "gone quiet" alert, or the all-clear once readings resume. */
  kind: "stale" | "recovered";
  /** The language every word in the message is written in. */
  locale: Locale;
  /** ISO instant of the newest stored reading; null when none was ever stored. */
  last_reading_at: string | null;
  /** How long the router was (kind "stale") or had been (kind "recovered") quiet. */
  silent_seconds: number;
  timezone: string;
  /** Dashboard link for the footer, when APP_URL is configured. */
  app_url: string | null;
  /**
   * What the router reported about the silence (lib/outage-cause.ts), for the
   * all-clear. Absent or empty when it reported nothing, e.g. an old script.
   */
  causes?: CauseSegment[] | null;
}

// --------------------------------------------------------------- palette --

/** Same palette as lib/email-cycle-template.ts, so the three mails read as one product. */
const C = {
  bg: "#fafaf9",
  card: "#ffffff",
  ink: "#171717",
  muted: "#71717a",
  border: "#e5e5e5",
  red: "#d03b3b",
  redTint: "#fdf2f2",
  green: "#0ca30c",
  greenTint: "#f1faf1",
} as const;

const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const FONT_AR = "Segoe UI,Tahoma,Geeza Pro,Noto Naskh Arabic,Arial,sans-serif";

// -------------------------------------------------------------- render ----

export function renderLinkEmail(report: LinkReport): RenderedEmail {
  const d = getDictionaryFor(report.locale);
  const t = d.emailLink;
  const f = makeFormatters(report.locale, d);
  const dir = DIRECTION[report.locale];
  const align = dir === "rtl" ? "right" : "left";
  const font = report.locale === "ar" ? FONT_AR : FONT;
  const stale = report.kind === "stale";

  const duration = formatDuration(report.silent_seconds, d.duration);
  // The timezone is settings data and is always validated on the way in
  // (see isValidTimeZone in app/api/settings/route.ts); this fallback is only
  // so a pure renderer never throws on a malformed value. The raw string is
  // still shown (and escaped) in the body text below.
  const zone = isValidTimeZone(report.timezone) ? report.timezone : "UTC";
  const time = report.last_reading_at ? f.stamp(report.last_reading_at, zone) : null;

  const subject = stale ? fill(t.subjectStale, { duration }) : t.subjectRecovered;
  const heading = stale ? t.headingStale : t.headingRecovered;
  const body = stale
    ? time
      ? fill(t.bodyStale, { time, timezone: report.timezone, duration })
      : t.bodyStaleNever
    : fill(t.bodyRecovered, { duration, time: time ?? "-", timezone: report.timezone });
  const footer = stale ? t.footerStale : t.footerRecovered;
  const causeLine =
    !stale && report.causes && report.causes.length > 0
      ? fill(t.bodyCause, {
          causes: report.causes
            .map((segment) =>
              fill(t.causePart, {
                cause: d.sessions.causes[segment.cause],
                duration: formatDuration(segmentSeconds(segment), d.duration),
              }),
            )
            .join(t.causeJoiner),
        })
      : null;
  const causes = [t.causePower, t.causeLink, t.causeScript, t.causeApp];

  // ---- plain text ----

  const textLines = [heading, "", body];
  if (causeLine) textLines.push("", causeLine);
  if (stale) {
    textLines.push("", t.causes, ...causes.map((cause) => `  - ${cause}`), "", t.checkHint);
  }
  textLines.push("", footer);
  if (report.app_url) textLines.push(fill(t.dashboardLine, { url: report.app_url }));
  const text = textLines.join("\n");

  // ---- html ----

  const accent = stale ? { bg: C.redTint, color: C.red } : { bg: C.greenTint, color: C.green };

  const causesHtml = stale
    ? `<p style="margin:0 0 8px;font-size:13px;color:${C.muted}">${esc(t.causes)}</p>` +
      `<ul style="margin:0 0 12px;padding-${align === "right" ? "right" : "left"}:20px;font-size:13px;color:${C.ink};line-height:1.6">` +
      causes.map((cause) => `<li>${esc(cause)}</li>`).join("") +
      `</ul>` +
      `<p style="margin:0 0 16px;font-size:12px;color:${C.muted}">${esc(t.checkHint)}</p>`
    : "";

  const button = report.app_url
    ? `<p style="margin:16px 0 0"><a href="${esc(report.app_url)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">${esc(t.openDashboard)}</a></p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="${report.locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:${C.bg}">
<div dir="${dir}" style="font-family:${font};max-width:520px;margin:0 auto;background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:20px 22px;text-align:${align}">
  <div style="display:inline-block;background:${accent.bg};color:${accent.color};font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border-radius:999px;margin-bottom:12px">${esc(heading)}</div>
  <p style="margin:0 0 16px;color:#444;font-size:14px;line-height:1.5">${esc(body)}</p>
  ${causeLine ? `<p style="margin:0 0 16px;color:${C.ink};font-size:14px;line-height:1.5">${esc(causeLine)}</p>` : ""}
  ${causesHtml}
  ${button}
  <p style="margin:16px 0 0;color:${C.muted};font-size:12px">${esc(footer)}</p>
</div>
</body>
</html>`;

  return { subject, text, html };
}
