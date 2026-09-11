/**
 * The figures the alert email shows, gathered from the same aggregates the
 * /stats page uses.
 *
 * Every section beyond the headline is fetched with allSettled and dropped on
 * failure. The alert fires once per day from the ingest path, and a broken
 * aggregate must never be the reason it does not go out: a thinner email beats
 * a silent quota breach. The headline numbers are passed in by the caller, so
 * the figure in the email is always the one that actually tripped the alert.
 */

import type { AlertDay, AlertReport } from "@/lib/email-template";
import { getDictionaryFor, type Dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

import { alertLocale, type SettingsRow } from "@/lib/settings";
import {
  getComplianceDays,
  getRangeSummary,
  getSeries,
  getSessionStats,
  getCycleUsage,
  summariseCompliance,
  type ComplianceDay,
} from "@/lib/stats";
import { localParts, localTimeInstant, toHHMM } from "@/lib/time";

/** How many days the history strip and the connection figures look back over. */
const HISTORY_DAYS = 7;

export interface AlertReportInput {
  settings: SettingsRow;
  kind: "alert" | "test";
  /** Local date whose quota window the alert belongs to, YYYY-MM-DD. */
  date: string;
  /** Usage that tripped the alert, measured over the quota window. */
  usedBytes: number;
  quotaBytes: number;
  now?: Date;
}

/** Shifts a YYYY-MM-DD local date by whole days, staying on the calendar. */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * "Mon" for a local date, in the alert's language.
 *
 * Read at midday UTC so no timezone can shift the day, and taken from the
 * dictionary rather than from Intl so the seven labels on the chart axis are
 * the same seven the dashboard uses.
 */
function weekdayLabel(date: string, d: Dictionary): string {
  const at = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return date.slice(5);
  // getUTCDay is 0 for Sunday; the dictionary runs Monday first.
  return d.weekdays[(at.getUTCDay() + 6) % 7];
}

function appUrl(): string | null {
  const raw = process.env.APP_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/** The ISO instants bounding a local quota window, clipped to `now`. */
function windowRange(settings: SettingsRow, date: string, now: Date) {
  const start = localTimeInstant(date, settings.window_start, settings.timezone);
  const end = localTimeInstant(date, settings.window_end, settings.timezone, 1);
  if (!start) return null;
  const to = end && end < now ? end : now;
  return to > start ? { from: start, to } : null;
}

export async function buildAlertReport(input: AlertReportInput): Promise<AlertReport> {
  const { settings, kind, date, usedBytes, quotaBytes } = input;
  const now = input.now ?? new Date();

  const todayRange = windowRange(settings, date, now);
  const historyFrom = localTimeInstant(shiftDate(date, -(HISTORY_DAYS - 1)), "00:00", settings.timezone);
  const historyRange = historyFrom ? { from: historyFrom, to: now } : null;

  const [todaySummary, todayHours, cycle, complianceDays, sessions] = await Promise.allSettled([
    todayRange ? getRangeSummary(todayRange) : Promise.reject(new Error("no window today")),
    todayRange
      ? getSeries(todayRange, "hour", settings.timezone)
      : Promise.reject(new Error("no window today")),
    getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone, now),
    historyRange
      ? getComplianceDays(historyRange, settings.timezone, settings.window_start, settings.window_end)
      : Promise.reject(new Error("no history range")),
    historyRange ? getSessionStats(historyRange) : Promise.reject(new Error("no history range")),
  ]);

  const summary = todaySummary.status === "fulfilled" ? todaySummary.value : null;

  // The busiest hour of the day, which is usually where the breach came from.
  let peakHour: number | null = null;
  let peakHourBytes = 0;
  if (todayHours.status === "fulfilled") {
    for (const point of todayHours.value) {
      if (point.total_bytes > peakHourBytes) {
        peakHourBytes = point.total_bytes;
        peakHour = Number(point.bucket.slice(11, 13));
      }
    }
    if (peakHour !== null && !Number.isFinite(peakHour)) peakHour = null;
  }

  const locale = alertLocale(settings);
  const dict = getDictionaryFor(locale);

  return {
    kind,
    locale,
    generated_at: now.toISOString(),
    date,
    timezone: settings.timezone,
    window: { start: toHHMM(settings.window_start), end: toHHMM(settings.window_end) },
    app_url: appUrl(),

    today: {
      used_bytes: usedBytes,
      quota_bytes: quotaBytes,
      percent: quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0,
      over_bytes: Math.max(0, usedBytes - quotaBytes),
      // The split is measured over the window, so it can differ from the
      // baseline total by a reading or two. Scaling it to match would invent
      // precision the counters do not have.
      tx_bytes: summary?.tx_bytes ?? 0,
      rx_bytes: summary?.rx_bytes ?? 0,
      peak_bytes_per_second: summary?.peak_bytes_per_second ?? 0,
      avg_bytes_per_second: summary?.avg_bytes_per_second ?? 0,
      peak_hour: peakHour,
      peak_hour_bytes: peakHourBytes,
    },

    cycle:
      cycle.status === "fulfilled"
        ? {
            used_bytes: cycle.value.used_bytes,
            cap_bytes: cycle.value.cap_bytes,
            percent: cycle.value.percent_of_cap,
            projected_bytes: cycle.value.projected_bytes,
            projected_percent: cycle.value.projected_percent,
            days_elapsed: cycle.value.days_elapsed,
            days_total: cycle.value.days_total,
            days_remaining: cycle.value.days_remaining,
            daily_budget_bytes: cycle.value.daily_budget_bytes,
            daily_average_bytes: cycle.value.daily_average_bytes,
            over: cycle.value.over,
          }
        : null,

    week:
      complianceDays.status === "fulfilled"
        ? summariseWeek(complianceDays.value, settings, dict)
        : null,

    connection:
      sessions.status === "fulfilled"
        ? {
            sessions: sessions.value.sessions,
            drops: sessions.value.drops,
            availability: sessions.value.availability,
            uptime_seconds: sessions.value.uptime_seconds,
            longest_seconds: sessions.value.longest_seconds,
            mtbf_seconds: sessions.value.mtbf_seconds,
          }
        : null,
  };
}

function summariseWeek(
  rows: ComplianceDay[],
  settings: SettingsRow,
  d: Dictionary,
): AlertReport["week"] {
  // Only days that were actually measured become bars. Padding the strip out to
  // seven would draw a fresh install as five days of zero traffic.
  const measured = rows.slice(-HISTORY_DAYS);
  if (measured.length === 0) return null;

  const summary = summariseCompliance(measured, settings.quota_gb);
  const days: AlertDay[] = measured.map((row) => ({
    day: row.day,
    label: weekdayLabel(row.day, d),
    used_bytes: row.used_bytes,
    over: row.used_bytes > summary.quota_bytes,
  }));

  const worstRow = summary.worst_day;
  return {
    days,
    quota_bytes: summary.quota_bytes,
    days_measured: summary.days_measured,
    days_over: summary.days_over,
    compliance_rate: summary.compliance_rate,
    average_bytes: summary.average_bytes,
    worst: worstRow
      ? {
          day: worstRow.day,
          label: weekdayLabel(worstRow.day, d),
          used_bytes: worstRow.used_bytes,
          over: worstRow.used_bytes > summary.quota_bytes,
        }
      : null,
  };
}

/**
 * A report built from nothing but the numbers already in hand. The last resort
 * when even the report builder fails, so the alert still says what it must.
 */
export function minimalAlertReport(input: AlertReportInput): AlertReport {
  const now = input.now ?? new Date();
  return {
    kind: input.kind,
    locale: alertLocale(input.settings),
    generated_at: now.toISOString(),
    date: input.date,
    timezone: input.settings.timezone,
    window: {
      start: toHHMM(input.settings.window_start),
      end: toHHMM(input.settings.window_end),
    },
    app_url: appUrl(),
    today: {
      used_bytes: input.usedBytes,
      quota_bytes: input.quotaBytes,
      percent: input.quotaBytes > 0 ? (input.usedBytes / input.quotaBytes) * 100 : 0,
      over_bytes: Math.max(0, input.usedBytes - input.quotaBytes),
      tx_bytes: 0,
      rx_bytes: 0,
      peak_bytes_per_second: 0,
      avg_bytes_per_second: 0,
      peak_hour: null,
      peak_hour_bytes: 0,
    },
    cycle: null,
    week: null,
    connection: null,
  };
}

/**
 * A believable report with no database behind it, for the preview route when
 * the deployment has no data yet. Never sent to anyone.
 */
export function sampleAlertReport(now = new Date(), locale: Locale = DEFAULT_LOCALE): AlertReport {
  const d = getDictionaryFor(locale);
  const date = localParts(now, "UTC").date;
  const quota = 10e9;
  const used = 12.4e9;
  const usedByDay = [4.1e9, 7.8e9, 12.9e9, 6.2e9, 3.4e9, 9.7e9, used];

  const days: AlertDay[] = usedByDay.map((bytes, i) => {
    const day = shiftDate(date, i - (usedByDay.length - 1));
    return { day, label: weekdayLabel(day, d), used_bytes: bytes, over: bytes > quota };
  });
  const worst = days.reduce((a, b) => (b.used_bytes > a.used_bytes ? b : a));
  const over = days.filter((d) => d.over).length;

  return {
    kind: "test",
    locale,
    generated_at: now.toISOString(),
    date,
    timezone: "UTC",
    window: { start: "09:00", end: "23:59" },
    app_url: appUrl(),
    today: {
      used_bytes: used,
      quota_bytes: quota,
      percent: (used / quota) * 100,
      over_bytes: used - quota,
      tx_bytes: 2.3e9,
      rx_bytes: 10.1e9,
      peak_bytes_per_second: 48e6,
      avg_bytes_per_second: 2.1e6,
      peak_hour: 21,
      peak_hour_bytes: 3.6e9,
    },
    cycle: {
      used_bytes: 187e9,
      cap_bytes: 500e9,
      percent: 37.4,
      projected_bytes: 402e9,
      projected_percent: 80.4,
      days_elapsed: 14,
      days_total: 30,
      days_remaining: 16,
      daily_budget_bytes: 19.5e9,
      daily_average_bytes: 13.3e9,
      over: false,
    },
    week: {
      days,
      quota_bytes: quota,
      days_measured: days.length,
      days_over: over,
      compliance_rate: ((days.length - over) / days.length) * 100,
      average_bytes: Math.round(usedByDay.reduce((a, b) => a + b, 0) / usedByDay.length),
      worst,
    },
    connection: {
      sessions: 6,
      drops: 5,
      availability: 99.2,
      uptime_seconds: 594_000,
      longest_seconds: 201_600,
      mtbf_seconds: 118_800,
    },
  };
}
