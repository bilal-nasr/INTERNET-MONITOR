/**
 * The full statistics payload: one object holding every figure the /stats page
 * shows, assembled from lib/stats.ts.
 *
 * Built in one place so the page and /api/stats can never drift apart, and
 * fetched as a single fan-out so a dozen aggregates cost one round trip's worth
 * of latency rather than a dozen.
 */

import { cycleBounds } from "@/lib/billing";
import type { Dictionary } from "@/lib/i18n";
import { rangeLabel, type ResolvedRange } from "@/lib/range";
import {
  fillSeries,
  foldIntoCycles,
  hourProfile,
  peakCell,
  summariseFree,
  weekdayProfile,
  type CycleTotal,
  type FreeSummary,
  type ProfileBar,
} from "@/lib/series";
import { dailyQuotaGb, type SettingsRow } from "@/lib/settings";
import { freeWindowOf, type FreeWindow } from "@/lib/time";
import {
  getComplianceDays,
  getCycleUsageFor,
  getFirstReadingAt,
  getHeatmap,
  getRangeSummary,
  getSeries,
  getSessionDurations,
  getSessionStats,
  getTopSessions,
  summariseCompliance,
  type ComplianceSummary,
  type CycleUsage,
  type DurationBucket,
  type HeatCell,
  type RangeSummary,
  type SeriesPoint,
  type SessionRangeStats,
  type TopSession,
} from "@/lib/stats";

/** How many billing cycles the cycle-history chart looks back over. */
const CYCLE_HISTORY = 12;

const TOP_SESSIONS = 10;

export interface StatsReport {
  generated_at: string;
  timezone: string;
  range: {
    preset: string;
    label: string;
    from: string | null;
    to: string;
    bucket: string;
    from_input: string | null;
    to_input: string | null;
  };
  quota: {
    /** Null when the daily quota is off. */
    daily_gb: number | null;
    monthly_gb: number;
    cycle_day: number;
    window_start: string;
    window_end: string;
    /** The free hours, or null while they are off. */
    free_window: FreeWindow | null;
  };
  summary: RangeSummary;
  series: SeriesPoint[];
  heatmap: HeatCell[];
  hours: ProfileBar[];
  weekdays: ProfileBar[];
  peak: HeatCell | null;
  /** Null when the daily quota is off: there is nothing to comply with. */
  compliance: ComplianceSummary | null;
  sessions: SessionRangeStats;
  durations: DurationBucket[];
  top_sessions: TopSession[];
  cycle: CycleUsage;
  cycle_history: CycleTotal[];
  /** Free-hours traffic over the range, per day; null while the free hours are off. */
  free: FreeSummary | null;
  first_reading_at: string | null;
}

/** The views of the statistics page, each of which reads only its own figures. */
export const STATS_VIEWS = ["overview", "patterns", "reliability", "quota", "free"] as const;
export type StatsView = (typeof STATS_VIEWS)[number];

export function isStatsView(value: unknown): value is StatsView {
  return typeof value === "string" && (STATS_VIEWS as readonly string[]).includes(value);
}

/** The part of a report that is settings and range only, and costs no query. */
export type StatsReportHead = Pick<StatsReport, "generated_at" | "timezone" | "range" | "quota">;

export function describeStatsReport(
  settings: SettingsRow,
  range: ResolvedRange,
  d: Dictionary,
  now = new Date(),
): StatsReportHead {
  return {
    generated_at: now.toISOString(),
    timezone: settings.timezone,
    range: {
      preset: range.preset,
      label: rangeLabel(d, range.preset),
      from: range.from?.toISOString() ?? null,
      to: range.to.toISOString(),
      bucket: range.bucket,
      from_input: range.from_input,
      to_input: range.to_input,
    },
    quota: {
      daily_gb: dailyQuotaGb(settings),
      monthly_gb: settings.monthly_quota_gb,
      cycle_day: settings.billing_cycle_day,
      window_start: settings.window_start.slice(0, 5),
      window_end: settings.window_end.slice(0, 5),
      free_window: freeWindowOf(settings),
    },
  };
}

export type OverviewFigures = Pick<StatsReport, "summary" | "series" | "cycle">;
export type PatternFigures = Pick<StatsReport, "summary" | "heatmap" | "hours" | "weekdays" | "peak">;
export type ReliabilityFigures = Pick<StatsReport, "sessions" | "durations" | "top_sessions">;
export type QuotaFigures = Pick<StatsReport, "compliance" | "cycle" | "cycle_history">;
export interface FreeFigures {
  free: FreeSummary;
  /** The range's buckets, each carrying its free-hours part. */
  series: SeriesPoint[];
}

/*
 * One loader per view of the statistics page. The page shows one view at a
 * time and reads only that view's queries, so opening it costs three or four
 * aggregates instead of all ten; the other views are read when their tab is
 * opened. /api/stats still returns everything at once through buildStatsReport.
 */

export async function loadOverviewFigures(settings: SettingsRow, range: ResolvedRange): Promise<OverviewFigures> {
  const params = { from: range.from, to: range.to };
  const [summary, rawSeries, cycle] = await Promise.all([
    getRangeSummary(params),
    // With the free hours, so the timeline can say how much of each bucket fell in them.
    getSeries(params, range.bucket, settings.timezone, freeWindowOf(settings)),
    getCycleUsageFor(settings),
  ]);
  return {
    summary,
    series: fillSeries(rawSeries, range.from, range.to, range.bucket, settings.timezone),
    cycle,
  };
}

export async function loadPatternFigures(
  settings: SettingsRow,
  range: ResolvedRange,
  d: Dictionary,
): Promise<PatternFigures> {
  const params = { from: range.from, to: range.to };
  const [summary, heatmap] = await Promise.all([getRangeSummary(params), getHeatmap(params, settings.timezone)]);
  return {
    summary,
    heatmap,
    hours: hourProfile(heatmap),
    weekdays: weekdayProfile(heatmap, d),
    peak: peakCell(heatmap),
  };
}

export async function loadReliabilityFigures(range: ResolvedRange, d: Dictionary): Promise<ReliabilityFigures> {
  const params = { from: range.from, to: range.to };
  const [sessions, durations, topSessions] = await Promise.all([
    getSessionStats(params),
    getSessionDurations(params, d),
    getTopSessions(params, TOP_SESSIONS),
  ]);
  return { sessions, durations, top_sessions: topSessions };
}

export async function loadQuotaFigures(
  settings: SettingsRow,
  range: ResolvedRange,
  now = new Date(),
): Promise<QuotaFigures> {
  const params = { from: range.from, to: range.to };
  const oldestCycle = cycleBounds(now, settings.billing_cycle_day, settings.timezone, -(CYCLE_HISTORY - 1));
  const quotaGb = dailyQuotaGb(settings);
  const [complianceDays, cycle, cycleDays] = await Promise.all([
    quotaGb === null
      ? null
      : getComplianceDays(params, settings.timezone, settings.window_start, settings.window_end, freeWindowOf(settings)),
    getCycleUsageFor(settings, now),
    getSeries({ from: oldestCycle.start, to: now }, "day", settings.timezone, freeWindowOf(settings)),
  ]);
  return {
    compliance: quotaGb === null || complianceDays === null ? null : summariseCompliance(complianceDays, quotaGb),
    cycle,
    cycle_history: foldIntoCycles(cycleDays, settings.billing_cycle_day, settings.timezone, CYCLE_HISTORY, now),
  };
}

/**
 * The free-hours view: the range's buckets, and its days for the table. A
 * range already bucketed by day needs only the one query. Null while the free
 * hours are off, since the view is not offered then.
 */
export async function loadFreeFigures(settings: SettingsRow, range: ResolvedRange): Promise<FreeFigures | null> {
  const free = freeWindowOf(settings);
  if (!free) return null;
  const params = { from: range.from, to: range.to };
  const [rawSeries, rawDays] = await Promise.all([
    getSeries(params, range.bucket, settings.timezone, free),
    range.bucket === "day" ? null : getSeries(params, "day", settings.timezone, free),
  ]);
  return {
    free: summariseFree(rawDays ?? rawSeries, free),
    series: fillSeries(rawSeries, range.from, range.to, range.bucket, settings.timezone),
  };
}

/**
 * `d` is the language the report is written in. The figures are language-free,
 * but a report also carries names -- the range, the weekdays, the session
 * length bands -- and those are resolved once here so the page and /api/stats
 * cannot end up labelling the same numbers differently.
 */
export async function buildStatsReport(
  settings: SettingsRow,
  range: ResolvedRange,
  d: Dictionary,
  now = new Date(),
): Promise<StatsReport> {
  const params = { from: range.from, to: range.to };

  // The cycle-history chart needs day totals reaching back to the start of the
  // oldest cycle it shows, which is a wider span than the selected range.
  const oldestCycle = cycleBounds(now, settings.billing_cycle_day, settings.timezone, -(CYCLE_HISTORY - 1));
  const quotaGb = dailyQuotaGb(settings);
  const free = freeWindowOf(settings);

  const [
    summary,
    rawSeries,
    heatmap,
    complianceDays,
    sessions,
    durations,
    topSessions,
    cycle,
    cycleDays,
    firstReadingAt,
    freeDays,
  ] = await Promise.all([
    getRangeSummary(params),
    getSeries(params, range.bucket, settings.timezone, free),
    getHeatmap(params, settings.timezone),
    quotaGb === null
      ? null
      : getComplianceDays(params, settings.timezone, settings.window_start, settings.window_end, freeWindowOf(settings)),
    getSessionStats(params),
    getSessionDurations(params, d),
    getTopSessions(params, TOP_SESSIONS),
    getCycleUsageFor(settings, now),
    getSeries({ from: oldestCycle.start, to: now }, "day", settings.timezone, freeWindowOf(settings)),
    getFirstReadingAt(),
    free === null || range.bucket === "day" ? null : getSeries(params, "day", settings.timezone, free),
  ]);

  return {
    ...describeStatsReport(settings, range, d, now),
    summary,
    series: fillSeries(rawSeries, range.from, range.to, range.bucket, settings.timezone),
    heatmap,
    hours: hourProfile(heatmap),
    weekdays: weekdayProfile(heatmap, d),
    peak: peakCell(heatmap),
    compliance: quotaGb === null || complianceDays === null ? null : summariseCompliance(complianceDays, quotaGb),
    sessions,
    durations,
    top_sessions: topSessions,
    cycle,
    cycle_history: foldIntoCycles(
      cycleDays,
      settings.billing_cycle_day,
      settings.timezone,
      CYCLE_HISTORY,
      now,
    ),
    free: free === null ? null : summariseFree(freeDays ?? rawSeries, free),
    first_reading_at: firstReadingAt,
  };
}
