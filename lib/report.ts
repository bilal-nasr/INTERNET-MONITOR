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
  weekdayProfile,
  type CycleTotal,
  type ProfileBar,
} from "@/lib/series";
import type { SettingsRow } from "@/lib/settings";
import {
  getComplianceDays,
  getCycleUsage,
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
    daily_gb: number;
    monthly_gb: number;
    cycle_day: number;
    window_start: string;
    window_end: string;
  };
  summary: RangeSummary;
  series: SeriesPoint[];
  heatmap: HeatCell[];
  hours: ProfileBar[];
  weekdays: ProfileBar[];
  peak: HeatCell | null;
  compliance: ComplianceSummary;
  sessions: SessionRangeStats;
  durations: DurationBucket[];
  top_sessions: TopSession[];
  cycle: CycleUsage;
  cycle_history: CycleTotal[];
  first_reading_at: string | null;
}

/** The views of the statistics page, each of which reads only its own figures. */
export const STATS_VIEWS = ["overview", "patterns", "reliability", "quota"] as const;
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
      daily_gb: settings.quota_gb,
      monthly_gb: settings.monthly_quota_gb,
      cycle_day: settings.billing_cycle_day,
      window_start: settings.window_start.slice(0, 5),
      window_end: settings.window_end.slice(0, 5),
    },
  };
}

export type OverviewFigures = Pick<StatsReport, "summary" | "series" | "cycle">;
export type PatternFigures = Pick<StatsReport, "summary" | "heatmap" | "hours" | "weekdays" | "peak">;
export type ReliabilityFigures = Pick<StatsReport, "sessions" | "durations" | "top_sessions">;
export type QuotaFigures = Pick<StatsReport, "compliance" | "cycle" | "cycle_history">;

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
    getSeries(params, range.bucket, settings.timezone),
    getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone),
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
  const [complianceDays, cycle, cycleDays] = await Promise.all([
    getComplianceDays(params, settings.timezone, settings.window_start, settings.window_end),
    getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone, now),
    getSeries({ from: oldestCycle.start, to: now }, "day", settings.timezone),
  ]);
  return {
    compliance: summariseCompliance(complianceDays, settings.quota_gb),
    cycle,
    cycle_history: foldIntoCycles(cycleDays, settings.billing_cycle_day, settings.timezone, CYCLE_HISTORY, now),
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
  ] = await Promise.all([
    getRangeSummary(params),
    getSeries(params, range.bucket, settings.timezone),
    getHeatmap(params, settings.timezone),
    getComplianceDays(params, settings.timezone, settings.window_start, settings.window_end),
    getSessionStats(params),
    getSessionDurations(params, d),
    getTopSessions(params, TOP_SESSIONS),
    getCycleUsage(settings.monthly_quota_gb, settings.billing_cycle_day, settings.timezone, now),
    getSeries({ from: oldestCycle.start, to: now }, "day", settings.timezone),
    getFirstReadingAt(),
  ]);

  return {
    ...describeStatsReport(settings, range, d, now),
    summary,
    series: fillSeries(rawSeries, range.from, range.to, range.bucket, settings.timezone),
    heatmap,
    hours: hourProfile(heatmap),
    weekdays: weekdayProfile(heatmap, d),
    peak: peakCell(heatmap),
    compliance: summariseCompliance(complianceDays, settings.quota_gb),
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
    first_reading_at: firstReadingAt,
  };
}
