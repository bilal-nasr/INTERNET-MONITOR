/**
 * The monthly-cap mail, rendered. Pure, like lib/email-template.ts: a
 * CycleReport in, subject and both bodies out. Far simpler than the daily
 * alert because there is one number to tell and no chart.
 */

import type { RenderedEmail } from "@/lib/email-template";
import { escapeHtml as esc, formatBytes } from "@/lib/format";
import { fill, getDictionaryFor } from "@/lib/i18n";
import { DIRECTION, type Locale } from "@/lib/i18n/config";
import { previousLocalDate } from "@/lib/time";

export interface CycleReport {
  kind: "threshold" | "pace";
  locale: Locale;
  generated_at: string;
  timezone: string;
  /** The mark reached, for a threshold mail; null for a pace warning. */
  threshold: number | null;
  app_url: string | null;
  cycle: {
    /**
     * Local dates, YYYY-MM-DD. `end` is exclusive: the day the next cycle
     * begins. The span is shown to the day before it, which is the last day
     * this cycle actually covers.
     */
    start: string;
    end: string;
    used_bytes: number;
    cap_bytes: number;
    percent: number;
    projected_bytes: number;
    projected_percent: number;
    days_elapsed: number;
    days_total: number;
    days_remaining: number;
    daily_budget_bytes: number;
    daily_average_bytes: number;
    over: boolean;
  };
}

function pct(value: number): string {
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}%`;
}

function values(report: CycleReport) {
  const c = report.cycle;
  return {
    used: formatBytes(c.used_bytes),
    cap: formatBytes(c.cap_bytes),
    percent: report.threshold !== null && !c.over ? `${report.threshold}%` : pct(c.percent),
    projected: formatBytes(c.projected_bytes),
    projectedPercent: pct(c.projected_percent),
  };
}

export function cycleSubject(report: CycleReport): string {
  const t = getDictionaryFor(report.locale).emailCycle;
  const v = values(report);
  if (report.kind === "pace") return fill(t.subjectPace, { projected: v.projected, cap: v.cap });
  return fill(report.cycle.over ? t.subjectOver : t.subjectThreshold, { percent: v.percent, used: v.used, cap: v.cap });
}

export function renderCycleEmail(report: CycleReport): RenderedEmail {
  const t = getDictionaryFor(report.locale).emailCycle;
  const c = report.cycle;
  const v = values(report);
  const dir = DIRECTION[report.locale];
  const align = dir === "rtl" ? "right" : "left";

  const intro =
    report.kind === "pace"
      ? fill(t.introPace, { projected: v.projected, cap: v.cap })
      : c.over
        ? t.introOver
        : fill(t.introThreshold, { percent: v.percent });
  const footer = report.kind === "pace" ? t.footerPace : c.over ? t.footerOver : t.footerThreshold;

  const rows: [string, string][] = [
    [t.cycleSpan, fill(t.cycleSpanValue, { start: c.start, end: previousLocalDate(c.end), timezone: report.timezone })],
    [t.used, fill(t.usedValue, { used: v.used, cap: v.cap, percent: pct(c.percent) })],
    [t.projected, fill(t.projectedValue, { projected: v.projected, percent: v.projectedPercent })],
    [t.progress, fill(t.progressValue, { elapsed: c.days_elapsed, total: c.days_total, remaining: c.days_remaining })],
    [t.dailyAverage, formatBytes(c.daily_average_bytes)],
    [t.budget, formatBytes(c.daily_budget_bytes)],
  ];

  const text = [
    intro,
    "",
    ...rows.map(([label, value]) => `  ${label.padEnd(24)}${value}`),
    "",
    footer,
    ...(report.app_url ? [fill(t.dashboardLine, { url: report.app_url })] : []),
  ].join("\n");

  const pad = "padding:6px 12px;font-size:14px";
  const table = rows
    .map(([label, value]) => `<tr><td style="${pad};color:#71717a">${esc(label)}</td><td style="${pad}">${esc(value)}</td></tr>`)
    .join("");
  const button = report.app_url
    ? `<p style="margin:16px 0 0"><a href="${esc(report.app_url)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">${esc(t.openDashboard)}</a></p>`
    : "";
  const html = `<div dir="${dir}" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;text-align:${align}">
      <h2 style="margin:0 0 12px">${esc(cycleSubject(report))}</h2>
      <p style="margin:0 0 16px;color:#444">${esc(intro)}</p>
      <table style="border-collapse:collapse">${table}</table>
      ${button}
      <p style="margin:16px 0 0;color:#888;font-size:12px">${esc(footer)}</p>
    </div>`;

  return { subject: cycleSubject(report), text, html };
}
