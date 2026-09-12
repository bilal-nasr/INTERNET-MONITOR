/**
 * The alert email, rendered.
 *
 * Pure: it takes an AlertReport and returns the subject, the plain-text body
 * and the HTML body. No database, no network, no clock. That is what makes the
 * layout testable and what lets the preview route render it from a fixture.
 *
 * Written as nested tables with inline styles because that is the only layout
 * every mail client agrees on. Flexbox, grid and external stylesheets are all
 * unavailable; heights come from table cells rather than divs so Outlook's Word
 * renderer draws the meters and the bar chart at the right size.
 *
 * Dark mode is the one place classes are used: the `dm-*` classes in the
 * <style> block are dropped by clients that strip it, which then keep the
 * inline light styling. So the light rendering has to stand on its own.
 *
 * The language comes in on the report. An alert is composed with no request
 * behind it, so there is no header to read it from; it is a fact about the
 * settings, decided where the report is built. Direction is threaded through
 * the helpers rather than set once on the body, because a mail client cannot be
 * relied on to inherit `dir` into a nested table.
 */

import { formatBytes } from "@/lib/format";
import { fill, getDictionaryFor, type Dictionary } from "@/lib/i18n";
import { DIRECTION, type Direction, type Locale } from "@/lib/i18n/config";
import { formatDuration } from "@/lib/time";

// --------------------------------------------------------------- input ----

export interface AlertDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  /** Short weekday label for the chart axis, already in the report's language. */
  label: string;
  used_bytes: number;
  over: boolean;
}

/**
 * Every figure the email shows. The optional sections are optional on purpose:
 * the alert has to go out even when an aggregate fails, so lib/email-report.ts
 * drops a section rather than losing the send.
 */
export interface AlertReport {
  /** A real over-quota alert, or the preview sent from the settings page. */
  kind: "alert" | "test";
  /** The language every word in the message is written in. */
  locale: Locale;
  generated_at: string;
  /** Local date the quota window belongs to. */
  date: string;
  timezone: string;
  window: { start: string; end: string };
  /** Dashboard link for the footer, when APP_URL is configured. */
  app_url: string | null;
  /** The percent mark this mail announces, when it is a threshold warning below 100; null otherwise. */
  threshold: number | null;

  today: {
    used_bytes: number;
    quota_bytes: number;
    percent: number;
    over_bytes: number;
    tx_bytes: number;
    rx_bytes: number;
    peak_bytes_per_second: number;
    avg_bytes_per_second: number;
    /** Local hour, 0-23, that carried the most traffic today. */
    peak_hour: number | null;
    peak_hour_bytes: number;
  };

  cycle: {
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
  } | null;

  week: {
    days: AlertDay[];
    quota_bytes: number;
    days_measured: number;
    days_over: number;
    compliance_rate: number;
    average_bytes: number;
    worst: AlertDay | null;
  } | null;

  connection: {
    sessions: number;
    drops: number;
    availability: number;
    uptime_seconds: number;
    longest_seconds: number;
    mtbf_seconds: number;
  } | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// ------------------------------------------------------------- palette ----

/** Taken from app/globals.css, so the email and the dashboard read as one product. */
const C = {
  bg: "#fafaf9",
  card: "#ffffff",
  ink: "#171717",
  muted: "#71717a",
  faint: "#a1a1aa",
  border: "#e5e5e5",
  track: "#ebebe9",
  blue: "#2a78d6",
  orange: "#eb6834",
  green: "#0ca30c",
  amber: "#fab219",
  red: "#d03b3b",
  redTint: "#fdf2f2",
  redBorder: "#f3d3d3",
  blueTint: "#f1f6fd",
  blueBorder: "#d3e2f6",
} as const;

/**
 * Two stacks, because Geist is not in this list and a mail client has no access
 * to a web font we serve. The Arabic stack names faces that ship with the major
 * desktop and mobile platforms, so the message lands the same way on each.
 */
const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const FONT_AR = "Segoe UI,Tahoma,Geeza Pro,Noto Naskh Arabic,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/**
 * Dark-mode partner for every colour used on text. The inline hex is tuned for
 * a white card; on the dark surface the same hex loses too much contrast, so
 * the class swaps in a lighter member of the same hue.
 */
const TONE_CLASS: Record<string, string> = {
  "#d03b3b": "dm-critical",
  "#fab219": "dm-warning",
  "#0ca30c": "dm-good",
  "#2a78d6": "dm-series-1",
  "#eb6834": "dm-series-2",
};

function toneClass(color?: string): string {
  return (color && TONE_CLASS[color]) || "";
}

/** Tint reserved for genuine state, never for series identity. */
function tone(percent: number): string {
  if (percent >= 100) return C.red;
  if (percent >= 80) return C.amber;
  return C.green;
}

// ------------------------------------------------------------- writing ----

/**
 * Everything about the message that is a property of the language rather than
 * of the data: the words, which way the layout runs, and which typeface and
 * tracking that script wants. Built once per render and passed down.
 */
interface Style {
  dir: Direction;
  /** The side a line of text begins on, and the side it ends on. */
  start: "left" | "right";
  end: "left" | "right";
  font: string;
  /** Latin tracking, or none. */
  tracking(value: string): string;
  d: Dictionary;
  /** The alert's own vocabulary, which is most of what this file writes. */
  t: Dictionary["emailAlert"];
}

function styleFor(locale: Locale): Style {
  const dir = DIRECTION[locale];
  const rtl = dir === "rtl";
  const d = getDictionaryFor(locale);
  return {
    dir,
    start: rtl ? "right" : "left",
    end: rtl ? "left" : "right",
    font: rtl ? FONT_AR : FONT,
    // Negative tracking pulls joined Arabic letters into each other, and the
    // positive tracking on an eyebrow exists to open up capitals, which Arabic
    // does not have. Both are Latin typography, so both are dropped.
    tracking: (value: string) => (rtl ? "normal" : value),
    d,
    t: d.emailAlert,
  };
}

// ------------------------------------------------------------ building ----

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Whole percentages above 10, one decimal below, so a small share is not "0%". */
function pct(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value >= 10 || value === 0) return `${Math.round(value)}%`;
  return `${value.toFixed(1)}%`;
}

/**
 * Availability keeps a decimal at every value. Rounded to whole percent, a link
 * that dropped for four hours and one that never dropped both read as "99%".
 */
function availability(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function rate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond, 1)}/s`;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function row(inner: string): string {
  return `<tr><td style="padding:0 24px">${inner}</td></tr>`;
}

function spacer(height: number): string {
  return `<tr><td style="height:${height}px;line-height:${height}px;font-size:0">&nbsp;</td></tr>`;
}

function card(inner: string, accent?: { bg: string; border: string; cls: string }): string {
  const bg = accent?.bg ?? C.card;
  const border = accent?.border ?? C.border;
  const cls = accent?.cls ?? "dm-card";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${cls}" style="background:${bg};border:1px solid ${border};border-radius:14px"><tr><td style="padding:20px">${inner}</td></tr></table>`;
}

function eyebrow(st: Style, text: string, color: string = C.muted, dot?: string): string {
  const marker = dot
    ? `<span style="display:inline-block;width:7px;height:7px;border-radius:99px;background:${dot};margin-${st.end}:7px"></span>`
    : "";
  const cls = color === C.muted ? "dm-muted" : toneClass(color);
  return `<div${cls ? ` class="${cls}"` : ""} style="font-family:${st.font};font-size:11px;font-weight:700;letter-spacing:${st.tracking(".09em")};text-transform:uppercase;color:${color};line-height:1.2">${marker}${esc(text)}</div>`;
}

/**
 * A proportional meter. The two cells are percentage widths of one table, which
 * is the only bar every client draws correctly; a zero-width cell is left out
 * because Outlook renders it as a one-pixel sliver of the wrong colour.
 *
 * It fills from the start of the line, so in Arabic it fills from the right and
 * the bar grows the way the reader's eye travels.
 */
function meter(st: Style, percent: number, color: string, height = 10): string {
  const filled = Math.max(0, Math.min(100, Math.round(percent)));
  const rest = 100 - filled;
  const cell = (width: number, background: string, cls?: string) =>
    width <= 0
      ? ""
      : `<td width="${width}%"${cls ? ` class="${cls}"` : ""} style="width:${width}%;height:${height}px;line-height:${height}px;font-size:0;background:${background}">&nbsp;</td>`;
  const cells =
    st.dir === "rtl"
      ? cell(rest, C.track, "dm-track") + cell(filled, color)
      : cell(filled, color) + cell(rest, C.track, "dm-track");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:99px;overflow:hidden;table-layout:fixed"><tr>${cells}</tr></table>`;
}

interface Stat {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}

/** Stats two to a row, which is what fits a phone without wrapping. */
function statGrid(st: Style, stats: Stat[]): string {
  // The gutter sits between the two columns, so it is on the trailing edge of
  // a cell: that is the right edge in English and the left edge in Arabic.
  const pad = st.dir === "rtl" ? "10px 0 10px 12px" : "10px 12px 10px 0";
  const cells = stats.map(
    (s) =>
      `<td width="50%" valign="top" align="${st.start}" style="width:50%;padding:${pad}">` +
      `<div style="font-family:${st.font};font-size:11px;color:${C.muted};line-height:1.3" class="dm-muted">${esc(s.label)}</div>` +
      `<div style="font-family:${st.font};font-size:17px;font-weight:600;color:${s.color ?? C.ink};line-height:1.35;padding-top:2px" class="${s.color ? toneClass(s.color) : "dm-text"}">${esc(s.value)}</div>` +
      (s.hint
        ? `<div style="font-family:${st.font};font-size:11px;color:${C.faint};line-height:1.3;padding-top:1px" class="dm-muted">${esc(s.hint)}</div>`
        : "") +
      `</td>`,
  );

  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    const pair = [cells[i], cells[i + 1] ?? '<td width="50%">&nbsp;</td>'];
    if (st.dir === "rtl") pair.reverse();
    rows.push(`<tr>${pair.join("")}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed">${rows.join("")}</table>`;
}

const CHART_HEIGHT = 76;

/**
 * A column chart drawn as one table per bar: a transparent spacer cell above a
 * coloured cell of the right height. Outlook ignores a div with a pixel height;
 * it does not ignore a table cell.
 *
 * The columns stay in calendar order whichever way the page runs. This is a
 * time axis, and reversing it would state something different about the week
 * rather than translate it.
 */
function barChart(st: Style, days: AlertDay[]): string {
  const max = Math.max(...days.map((d) => d.used_bytes), 1);
  const width = (100 / days.length).toFixed(2);

  const columns = days.map((d) => {
    // A day with traffic always gets a visible sliver, so "small" never reads
    // as "none" on the chart.
    const height =
      d.used_bytes > 0 ? Math.max(3, Math.round((d.used_bytes / max) * CHART_HEIGHT)) : 0;
    const gap = CHART_HEIGHT - height;
    const color = d.over ? C.red : C.blue;
    const bar =
      height > 0
        ? `<tr><td style="height:${height}px;line-height:${height}px;font-size:0;background:${color};border-radius:4px 4px 0 0">&nbsp;</td></tr>`
        : `<tr><td class="dm-track" style="height:2px;line-height:2px;font-size:0;background:${C.track};border-radius:2px">&nbsp;</td></tr>`;
    return (
      `<td width="${width}%" valign="bottom" align="center" style="width:${width}%;padding:0 3px">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
      (gap > 0 ? `<tr><td style="height:${gap}px;line-height:${gap}px;font-size:0">&nbsp;</td></tr>` : "") +
      bar +
      `</table></td>`
    );
  });

  const labels = days.map(
    (d) =>
      `<td width="${width}%" align="center" style="width:${width}%;padding:7px 0 0;font-family:${st.font};font-size:11px;color:${d.over ? C.red : C.muted};font-weight:${d.over ? 600 : 400}"${d.over ? "" : ' class="dm-muted"'}>${esc(d.label)}</td>`,
  );

  const values = days.map(
    (d) =>
      `<td width="${width}%" align="center" style="width:${width}%;padding:2px 0 0;font-family:${MONO};font-size:10px;color:${C.faint}" class="dm-muted">${esc(formatBytes(d.used_bytes, d.used_bytes >= 1e9 ? 1 : 0))}</td>`,
  );

  const baseline = `<tr><td colspan="${days.length}" class="dm-rule" style="height:1px;line-height:1px;font-size:0;background:${C.border}">&nbsp;</td></tr>`;
  return `<table role="presentation" dir="ltr" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed"><tr>${columns.join("")}</tr>${baseline}<tr>${labels.join("")}</tr><tr>${values.join("")}</tr></table>`;
}

function kv(st: Style, label: string, value: string, color?: string): string {
  return (
    `<tr><td align="${st.start}" style="padding:5px 0;font-family:${st.font};font-size:13px;color:${C.muted}" class="dm-muted">${esc(label)}</td>` +
    `<td align="${st.end}" style="padding:5px 0;font-family:${st.font};font-size:13px;font-weight:600;color:${color ?? C.ink}" class="${color ? toneClass(color) : "dm-text"}">${esc(value)}</td></tr>`
  );
}

// -------------------------------------------------------------- render ----

export function renderAlertEmail(report: AlertReport): RenderedEmail {
  const st = styleFor(report.locale);
  return {
    subject: subjectLine(report),
    text: renderText(report, st),
    html: renderHtml(report, st),
  };
}

/** A warning at a mark below the quota, as opposed to a breach or a plain report. */
function isWarning(report: AlertReport): boolean {
  return report.threshold !== null && report.threshold < 100 && report.today.used_bytes <= report.today.quota_bytes;
}

export function subjectLine(report: AlertReport): string {
  const st = styleFor(report.locale);
  const { today } = report;
  const over = today.used_bytes > today.quota_bytes;
  const prefix = report.kind === "test" ? st.t.testPrefix : "";
  const template = over ? st.t.subjectExceeded : isWarning(report) ? st.t.subjectThreshold : st.t.subjectReport;
  return (
    prefix +
    fill(template, {
      used: formatBytes(today.used_bytes),
      quota: formatBytes(today.quota_bytes),
      // The mark is what the reader is being told about; the exact figure follows in the body.
      percent: isWarning(report) ? `${report.threshold}%` : pct(today.percent),
      date: report.date,
    })
  );
}

/**
 * The plain-text body.
 *
 * Labels are padded into a column, which is the only alignment a plain-text
 * mail can rely on. A translated label longer than its English counterpart
 * widens that column rather than breaking it.
 */
const LABEL_WIDTH = 14;

function line(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}

function renderText(report: AlertReport, st: Style): string {
  const { today, cycle, week, connection } = report;
  const { t, d } = st;
  const L = t.labels;
  const lines: string[] = [];

  if (report.kind === "test") {
    lines.push(t.textTestBanner, "");
  }

  lines.push(
    today.used_bytes > today.quota_bytes
      ? t.introExceeded
      : isWarning(report)
        ? fill(t.introThreshold, { percent: `${report.threshold}%` })
        : t.introReport,
    "",
    t.sectionToday,
    line(L.date, fill(t.textDate, { date: report.date, timezone: report.timezone })),
    line(L.window, fill(t.textWindow, { start: report.window.start, end: report.window.end })),
    line(
      L.used,
      fill(t.textUsed, {
        used: formatBytes(today.used_bytes),
        quota: formatBytes(today.quota_bytes),
        percent: pct(today.percent),
      }),
    ),
  );
  if (today.over_bytes > 0) lines.push(line(L.overBy, formatBytes(today.over_bytes)));
  lines.push(
    line(L.download, formatBytes(today.rx_bytes)),
    line(L.upload, formatBytes(today.tx_bytes)),
    line(L.peakRate, rate(today.peak_bytes_per_second)),
    line(L.averageRate, rate(today.avg_bytes_per_second)),
  );
  if (today.peak_hour !== null) {
    lines.push(
      line(
        L.busiestHour,
        fill(t.textBusiestHour, {
          hour: hourLabel(today.peak_hour),
          bytes: formatBytes(today.peak_hour_bytes),
        }),
      ),
    );
  }

  if (cycle) {
    lines.push(
      "",
      t.sectionCycle,
      line(
        L.used,
        fill(t.textUsed, {
          used: formatBytes(cycle.used_bytes),
          quota: formatBytes(cycle.cap_bytes),
          percent: pct(cycle.percent),
        }),
      ),
      line(
        L.projected,
        fill(t.textProjected, {
          projected: formatBytes(cycle.projected_bytes),
          percent: pct(cycle.projected_percent),
        }),
      ),
      line(
        L.progress,
        fill(t.textProgress, {
          elapsed: cycle.days_elapsed,
          total: cycle.days_total,
          remaining: cycle.days_remaining,
        }),
      ),
      line(L.dailyAverage, formatBytes(cycle.daily_average_bytes)),
      line(L.budgetLeft, fill(t.textBudget, { bytes: formatBytes(cycle.daily_budget_bytes) })),
    );
  }

  if (week && week.days.length > 0) {
    lines.push("", t.sectionWeek);
    for (const day of week.days) {
      lines.push(
        `  ${day.day}  ${formatBytes(day.used_bytes).padStart(9)}${day.over ? t.textOverMarker : ""}`,
      );
    }
    lines.push(
      `  ${fill(t.textDaysOver, {
        over: week.days_over,
        measured: week.days_measured,
        percent: pct(week.compliance_rate),
      })}`,
      line(L.dailyAverage, formatBytes(week.average_bytes)),
    );
    if (week.worst) {
      lines.push(
        line(
          L.heaviestDay,
          fill(t.textDayAndBytes, {
            day: week.worst.day,
            bytes: formatBytes(week.worst.used_bytes),
          }),
        ),
      );
    }
  }

  if (connection) {
    lines.push(
      "",
      t.sectionConnection,
      line(L.sessions, String(connection.sessions)),
      line(L.drops, String(connection.drops)),
      line(L.availability, availability(connection.availability)),
      line(L.longestUp, formatDuration(connection.longest_seconds, d.duration)),
      line(
        L.meanUptime,
        fill(t.textMeanUptime, { duration: formatDuration(connection.mtbf_seconds, d.duration) }),
      ),
    );
  }

  lines.push("");
  lines.push(report.kind === "test" ? t.testFooter : isWarning(report) ? t.thresholdFooter : t.alertFooter);
  if (report.app_url) lines.push(fill(t.dashboardLine, { url: report.app_url }));

  return lines.join("\n");
}

function renderHtml(report: AlertReport, st: Style): string {
  const { today, cycle, week, connection } = report;
  const { t, d, font } = st;
  const over = today.used_bytes > today.quota_bytes;
  const headlineTone = tone(today.percent);
  const accent = over
    ? { bg: C.redTint, border: C.redBorder, cls: "dm-accent-critical" }
    : { bg: C.blueTint, border: C.blueBorder, cls: "dm-accent-info" };

  const sections: string[] = [];

  // Test banner first, so nobody mistakes a preview for a real alert.
  if (report.kind === "test") {
    sections.push(
      row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.ink};border-radius:10px"><tr><td style="padding:11px 14px;font-family:${font};font-size:12px;color:#ffffff;line-height:1.45"><strong>${esc(t.testBannerLead)}</strong>${esc(t.testBannerRest)}</td></tr></table>`,
      ),
      spacer(14),
    );
  }

  // Headline: the one number the reader opened the mail for.
  sections.push(
    row(
      card(
        eyebrow(
          st,
          over ? t.eyebrowExceeded : isWarning(report) ? fill(t.eyebrowThreshold, { percent: `${report.threshold}%` }) : t.eyebrowReport,
          headlineTone,
          headlineTone,
        ) +
          `<div style="font-family:${font};font-size:38px;font-weight:700;letter-spacing:${st.tracking("-.02em")};color:${C.ink};line-height:1.1;padding:10px 0 2px" class="dm-text">${esc(formatBytes(today.used_bytes))}</div>` +
          `<div style="font-family:${font};font-size:13px;color:${C.muted};line-height:1.4;padding-bottom:14px" class="dm-muted">${esc(fill(t.ofDailyQuota, { quota: formatBytes(today.quota_bytes) }))} &middot; <strong class="${toneClass(headlineTone)}" style="color:${headlineTone}">${esc(pct(today.percent))}</strong></div>` +
          meter(st, today.percent, headlineTone) +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px">` +
          (over
            ? kv(st, t.overQuotaBy, formatBytes(today.over_bytes), C.red)
            : kv(
                st,
                t.remainingToday,
                formatBytes(Math.max(0, today.quota_bytes - today.used_bytes)),
                C.green,
              )) +
          kv(
            st,
            t.quotaWindow,
            fill(t.windowSpan, { start: report.window.start, end: report.window.end }),
          ) +
          kv(st, t.labels.date, fill(t.textDate, { date: report.date, timezone: report.timezone })) +
          `</table>`,
        accent,
      ),
    ),
    spacer(14),
  );

  // Today in detail.
  const todayStats: Stat[] = [
    { label: t.labels.download, value: formatBytes(today.rx_bytes), color: C.blue },
    { label: t.labels.upload, value: formatBytes(today.tx_bytes), color: C.orange },
    { label: t.labels.peakRate, value: rate(today.peak_bytes_per_second) },
    { label: t.labels.averageRate, value: rate(today.avg_bytes_per_second) },
  ];
  if (today.peak_hour !== null) {
    todayStats.push({
      label: t.labels.busiestHour,
      value: hourLabel(today.peak_hour),
      hint: formatBytes(today.peak_hour_bytes),
    });
  }
  sections.push(
    row(
      card(
        eyebrow(st, t.todayTraffic) +
          `<div style="height:6px;line-height:6px;font-size:0">&nbsp;</div>` +
          statGrid(st, todayStats),
      ),
    ),
    spacer(14),
  );

  if (cycle) {
    const cycleTone = tone(cycle.percent);
    sections.push(
      row(
        card(
          eyebrow(st, t.billingCycle) +
            `<div style="font-family:${font};font-size:22px;font-weight:700;color:${C.ink};line-height:1.25;padding:9px 0 2px" class="dm-text">${esc(formatBytes(cycle.used_bytes))} <span style="font-size:13px;font-weight:400;color:${C.muted}">${esc(fill(t.cycleOf, { cap: formatBytes(cycle.cap_bytes) }))}</span></div>` +
            `<div style="font-family:${font};font-size:12px;color:${C.muted};line-height:1.4;padding-bottom:12px" class="dm-muted">${esc(fill(t.cycleDayLine, { elapsed: cycle.days_elapsed, total: cycle.days_total }))} &middot; <strong class="${toneClass(cycleTone)}" style="color:${cycleTone}">${esc(pct(cycle.percent))}</strong>${esc(t.cycleUsedSuffix)}</div>` +
            meter(st, cycle.percent, cycleTone, 8) +
            `<div style="height:4px;line-height:4px;font-size:0">&nbsp;</div>` +
            statGrid(st, [
              {
                label: t.projectedAtEnd,
                value: formatBytes(cycle.projected_bytes),
                hint: fill(t.ofCapHint, { percent: pct(cycle.projected_percent) }),
                color: cycle.projected_percent >= 100 ? C.red : undefined,
              },
              {
                label: t.budgetPerDay,
                value: formatBytes(cycle.daily_budget_bytes),
                hint:
                  cycle.days_remaining > 0
                    ? fill(t.daysLeft, { days: cycle.days_remaining })
                    : t.cycleEndsToday,
              },
              { label: t.dailyAverageSoFar, value: formatBytes(cycle.daily_average_bytes) },
              {
                label: t.cycleStatus,
                value: cycle.over ? t.overCap : t.withinCap,
                color: cycle.over ? C.red : C.green,
              },
            ]),
        ),
      ),
      spacer(14),
    );
  }

  if (week && week.days.length > 0) {
    const complianceTone =
      week.compliance_rate >= 90 ? C.green : week.compliance_rate >= 60 ? C.amber : C.red;
    sections.push(
      row(
        card(
          eyebrow(st, t.lastSevenDays) +
            `<div style="font-family:${font};font-size:12px;color:${C.muted};line-height:1.4;padding:7px 0 14px" class="dm-muted">${esc(fill(t.weekIntro, { quota: formatBytes(week.quota_bytes) }))}</div>` +
            barChart(st, week.days) +
            `<div style="height:14px;line-height:14px;font-size:0">&nbsp;</div>` +
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.border}" class="dm-divider">` +
            kv(
              st,
              t.daysOverQuota,
              fill(t.ofCount, { over: week.days_over, measured: week.days_measured }),
              week.days_over > 0 ? C.red : C.green,
            ) +
            kv(st, t.compliance, pct(week.compliance_rate), complianceTone) +
            kv(st, t.labels.dailyAverage, formatBytes(week.average_bytes)) +
            (week.worst
              ? kv(
                  st,
                  t.labels.heaviestDay,
                  fill(t.textDayAndBytes, {
                    day: week.worst.day,
                    bytes: formatBytes(week.worst.used_bytes),
                  }),
                )
              : "") +
            `</table>`,
        ),
      ),
      spacer(14),
    );
  }

  if (connection) {
    sections.push(
      row(
        card(
          eyebrow(st, t.connectionHealth) +
            `<div style="font-family:${font};font-size:12px;color:${C.muted};line-height:1.4;padding:7px 0 0" class="dm-muted">${esc(t.connectionIntro)}</div>` +
            statGrid(st, [
              {
                label: t.labels.availability,
                value: availability(connection.availability),
                color:
                  connection.availability >= 99
                    ? C.green
                    : connection.availability >= 95
                      ? C.amber
                      : C.red,
              },
              {
                label: t.labels.drops,
                value: String(connection.drops),
                color: connection.drops > 0 ? C.amber : undefined,
              },
              { label: t.labels.sessions, value: String(connection.sessions) },
              {
                label: t.totalUptime,
                value: formatDuration(connection.uptime_seconds, d.duration),
              },
              {
                label: t.longestSession,
                value: formatDuration(connection.longest_seconds, d.duration),
              },
              {
                label: t.meanTimeBetweenDrops,
                value: formatDuration(connection.mtbf_seconds, d.duration),
              },
            ]),
        ),
      ),
      spacer(14),
    );
  }

  const button = report.app_url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr><td style="background:${C.ink};border-radius:9px" class="dm-button"><a href="${esc(report.app_url)}" style="display:inline-block;padding:11px 22px;font-family:${font};font-size:13px;font-weight:600;color:#ffffff;text-decoration:none">${esc(t.openDashboard)}</a></td></tr></table><div style="height:16px;line-height:16px;font-size:0">&nbsp;</div>`
    : "";

  const preheader = fill(over ? t.preheaderOver : t.preheaderUnder, {
    used: formatBytes(today.used_bytes),
    quota: formatBytes(today.quota_bytes),
    percent: pct(today.percent),
    date: report.date,
  });

  const footerNote = report.kind === "test" ? t.footerTest : isWarning(report) ? t.thresholdFooter : t.alertFooter;

  return `<!DOCTYPE html>
<html lang="${report.locale}" dir="${st.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subjectLine(report))}</title>
<style>
  /* Dropped by clients that strip <style>; those keep the inline light styling. */
  @media (prefers-color-scheme: dark) {
    .dm-bg { background: #121211 !important; }
    .dm-card { background: #1a1a19 !important; border-color: #2e2e2c !important; }
    .dm-accent-critical { background: #241718 !important; border-color: #5a2a2c !important; }
    .dm-accent-info { background: #151d29 !important; border-color: #2a4468 !important; }
    .dm-text, .dm-text * { color: #ededed !important; }
    .dm-muted, .dm-muted * { color: #a1a1aa !important; }
    .dm-track { background: #2e2e2c !important; }
    .dm-divider { border-top-color: #2e2e2c !important; }
    .dm-rule { background: #2e2e2c !important; }
    .dm-critical, .dm-critical * { color: #f19191 !important; }
    .dm-warning, .dm-warning * { color: #ffce5c !important; }
    .dm-good, .dm-good * { color: #4fd07a !important; }
    .dm-series-1, .dm-series-1 * { color: #6da7ec !important; }
    .dm-series-2, .dm-series-2 * { color: #f5906a !important; }
    .dm-button { background: #3987e5 !important; }
  }
  @media only screen and (max-width: 620px) {
    .shell { width: 100% !important; }
  }
</style>
</head>
<body class="dm-bg" style="margin:0;padding:0;background:${C.bg};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="dm-bg" style="background:${C.bg}">
<tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="shell" style="width:600px;max-width:600px">
<tr><td style="padding:0 24px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="${st.start}" style="font-family:${font};font-size:13px;font-weight:600;color:${C.ink};letter-spacing:${st.tracking("-.01em")}" class="dm-text">${esc(t.brand)}</td>
<td align="${st.end}" style="font-family:${font};font-size:12px;color:${C.faint}" class="dm-muted">${esc(report.date)}</td>
</tr></table>
</td></tr>
${sections.join("\n")}
<tr><td align="center" style="padding:4px 24px 0">
${button}
<div style="font-family:${font};font-size:11px;color:${C.faint};line-height:1.6" class="dm-muted">${esc(footerNote)}<br>${esc(fill(t.generatedLine, { at: report.generated_at, timezone: report.timezone }))}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
