import type { Metadata } from "next";
import { connection } from "next/server";
import { AnomalyList } from "@/components/AnomalyList";
import { RangePicker } from "@/components/RangePicker";
import { Tabs } from "@/components/Tabs";
import { Card, StatTiles, type Tile } from "@/components/stats/chrome";
import { ComplianceChart } from "@/components/stats/ComplianceChart";
import { CycleGauge } from "@/components/stats/CycleGauge";
import { CycleHistoryChart } from "@/components/stats/CycleHistoryChart";
import { FreeDaysTable } from "@/components/stats/FreeDaysTable";
import { FreeHoursChart } from "@/components/stats/FreeHoursChart";
import { AvailabilityDonut, TrafficSplitDonut } from "@/components/stats/Donuts";
import { DurationChart, HourProfileChart, WeekdayProfileChart } from "@/components/stats/Profiles";
import { TopSessionsTable } from "@/components/stats/TopSessionsTable";
import { UsageHeatmap } from "@/components/stats/UsageHeatmap";
import { UsageTimeline } from "@/components/stats/UsageTimeline";
import { flagAnomalies } from "@/lib/anomaly";
import { formatBytes } from "@/lib/format";
import { fill, plural, type Dictionary } from "@/lib/i18n";
import type { Formatters } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import {
  DEFAULT_PRESET,
  InvalidRangeError,
  rangeErrorMessage,
  resolveRange,
  type BucketUnit,
  type ResolvedRange,
} from "@/lib/range";
import {
  describeStatsReport,
  isStatsView,
  loadFreeFigures,
  loadOverviewFigures,
  loadPatternFigures,
  loadQuotaFigures,
  loadReliabilityFigures,
  type FreeFigures,
  type OverviewFigures,
  type PatternFigures,
  type ReliabilityFigures,
  type StatsReportHead,
  type StatsView,
} from "@/lib/report";
import { getSettings, type SettingsRow } from "@/lib/settings";
import type { ComplianceSummary } from "@/lib/stats";
import type { FreeSummary } from "@/lib/series";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.stats.title} - ${d.meta.appName}` };
}

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** What the tile builders below need: the numbers, plus how to write them. */
interface Words {
  locale: Locale;
  d: Dictionary;
  f: Formatters;
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();

  const { locale, d, f } = await getI18n();
  const w: Words = { locale, d, f };

  const params = await searchParams;
  const settings = await getSettings();
  const input = {
    range: one(params.range),
    from: one(params.from),
    to: one(params.to),
    bucket: one(params.bucket),
  };
  const options = { timezone: settings.timezone, cycleDay: settings.billing_cycle_day };

  // A bad range in the URL should show the default view with an explanation,
  // not an error page: the URL is hand-editable and shared between people.
  let rangeError: string | null = null;
  let range;
  try {
    range = resolveRange(input, options);
  } catch (err) {
    if (!(err instanceof InvalidRangeError)) throw err;
    rangeError = rangeErrorMessage(d, err);
    range = resolveRange({ range: DEFAULT_PRESET }, options);
  }

  // Settings and range only: the heading costs no query, so the page shell
  // never waits on a figure.
  const report = describeStatsReport(settings, range, d);
  const requested = one(params.view);
  // The free-hours view exists only while free hours are on; a link to it
  // kept from before they were turned off opens the overview instead.
  const hasFree = report.quota.free_window !== null;
  const view: StatsView =
    isStatsView(requested) && (requested !== "free" || hasFree) ? requested : "overview";
  // Views already opened are kept while the range stays the same.
  const cacheKey = [range.preset, range.from_input ?? "", range.to_input ?? "", range.bucket].join("|");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{d.stats.title}</h1>
        <p className="text-sm text-muted">
          {fill(d.stats.subtitle, { range: report.range.label, timezone: report.timezone })}
          {" · "}
          {report.range.from ? describeRange(report, f, d) : d.stats.everythingRecorded}
        </p>
      </div>

      <RangePicker
        preset={report.range.preset}
        from={report.range.from_input}
        to={report.range.to_input}
      />

      {rangeError && (
        <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm">
          {fill(d.rangePicker.fallback, { reason: rangeError })}
        </p>
      )}

      {/* Four views over the same range, so the picker above stays put while
          the page below it is one screenful at a time instead of all twenty
          charts in a row. Only the open view is read from the database. */}
      <Tabs
        param="view"
        label={d.stats.tabs.label}
        current={view}
        cacheKey={cacheKey}
        tabs={[
          { id: "overview", label: d.stats.tabs.overview },
          { id: "patterns", label: d.stats.tabs.patterns },
          { id: "reliability", label: d.stats.tabs.reliability },
          { id: "quota", label: d.stats.tabs.quota },
          ...(hasFree ? [{ id: "free", label: d.stats.tabs.free }] : []),
        ]}
        fallback={<PanelSkeleton />}
        // Awaited, not wrapped in Suspense: Tabs keeps this element to show
        // again later, and a boundary still streaming inside a kept element is
        // never revealed. One view's queries take a single round trip, and the
        // skeleton above covers the wait when a tab is opened.
        content={await StatsPanel({ view, settings, range, report, w })}
      />

      <p className="text-xs text-muted">{d.stats.methodology}</p>
    </div>
  );
}

/**
 * One view of the page, reading only the figures that view draws. The other
 * views' queries do not run until their tab is opened (components/Tabs.tsx).
 */
async function StatsPanel({
  view,
  settings,
  range,
  report,
  w,
}: {
  view: StatsView;
  settings: SettingsRow;
  range: ResolvedRange;
  report: StatsReportHead;
  w: Words;
}) {
  const { d, f } = w;

  if (view === "patterns") {
    const figures = await loadPatternFigures(settings, range, d);
    return (
      <>
        <StatTiles tiles={patternTiles(figures, report, w)} columns={3} />
        <Card title={d.stats.trafficByWeekdayAndHour} hint={d.stats.localTime}>
          <UsageHeatmap cells={figures.heatmap} />
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={d.stats.trafficByHour}>
            <HourProfileChart hours={figures.hours} />
          </Card>
          <Card title={d.stats.trafficByWeekday}>
            <WeekdayProfileChart weekdays={figures.weekdays} />
          </Card>
        </div>
      </>
    );
  }

  if (view === "reliability") {
    const figures = await loadReliabilityFigures(range, d);
    return (
      <>
        <StatTiles tiles={reliabilityTiles(figures, w)} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={d.stats.timeOnline} hint={d.stats.timeOnlineHint}>
            <AvailabilityDonut
              uptimeSeconds={figures.sessions.uptime_seconds}
              downtimeSeconds={figures.sessions.downtime_seconds}
              availability={figures.sessions.availability}
            />
          </Card>
          <Card title={d.stats.sessionLengths}>
            <DurationChart durations={figures.durations} />
          </Card>
        </div>
        <Card title={d.stats.heaviestSessions} hint={d.stats.topTenByTraffic}>
          <TopSessionsTable sessions={figures.top_sessions} timezone={report.timezone} />
        </Card>
      </>
    );
  }

  if (view === "quota") {
    const figures = await loadQuotaFigures(settings, range);
    // Judged on window-only usage, which is what the compliance chart draws, so a
    // flagged bar and a flagged line describe the same number.
    // Without a daily quota there is nothing to comply with, and the tab is
    // left with the monthly cap.
    const compliance = figures.compliance;
    const anomalies = compliance ? flagAnomalies(compliance.days) : [];
    return (
      <>
        {compliance && report.quota.daily_gb !== null && (
          <>
            <StatTiles tiles={complianceTiles(compliance, w)} />
            <Card
              title={d.stats.dailyUsageInWindow}
              hint={fill(d.stats.dailyUsageInWindowHint, {
                start: report.quota.window_start,
                end: report.quota.window_end,
                quota: report.quota.daily_gb,
              })}
            >
              <ComplianceChart compliance={compliance} />
            </Card>
            <AnomalyList flags={anomalies} />
          </>
        )}
        <CycleGauge cycle={figures.cycle} timezone={report.timezone} />
        <Card
          title={d.stats.consumptionPerCycle}
          hint={fill(d.stats.cycleStartsOnDay, { day: report.quota.cycle_day })}
        >
          <CycleHistoryChart cycles={figures.cycle_history} capGb={report.quota.monthly_gb} />
        </Card>
      </>
    );
  }

  // Null while the free hours are off, which is also when the view is never
  // chosen (see `hasFree`).
  const freeFigures: FreeFigures | null = view === "free" ? await loadFreeFigures(settings, range) : null;
  if (freeFigures) {
    const { free } = freeFigures;
    return (
      <>
        <StatTiles tiles={freeTiles(free, w)} />
        <Card
          title={fill(d.stats.freeOverTime, { bucket: d.buckets[report.range.bucket as BucketUnit] })}
          hint={<FreeWindowHint free={free} d={d} />}
        >
          <FreeHoursChart
            series={freeFigures.series}
            bucket={report.range.bucket as BucketUnit}
            totals={free}
          />
        </Card>
        <Card title={d.stats.freePerDay} hint={d.stats.freePerDayHint}>
          <FreeDaysTable days={free.days} />
        </Card>
      </>
    );
  }

  const figures = await loadOverviewFigures(settings, range);
  return (
    <>
      <StatTiles tiles={volumeTiles(figures, w)} />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card
          title={fill(d.stats.trafficOverTime, {
            bucket: d.buckets[report.range.bucket as BucketUnit],
          })}
          hint={fill(d.common.readingsCount, { count: f.count(figures.summary.readings) })}
        >
          <UsageTimeline
            series={figures.series}
            bucket={report.range.bucket as BucketUnit}
            totals={figures.summary}
          />
        </Card>
        <Card title={d.stats.downloadAndUpload} hint={d.stats.shareOfTotal}>
          <TrafficSplitDonut rxBytes={figures.summary.rx_bytes} txBytes={figures.summary.tx_bytes} />
        </Card>
      </div>
    </>
  );
}

/** Stands in for a view while its figures are read: a row of tiles and two cards. */
function PanelSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[5.5rem] rounded-xl border border-border bg-surface" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="h-72 rounded-xl border border-border bg-surface" />
        <div className="h-72 rounded-xl border border-border bg-surface" />
      </div>
    </div>
  );
}

function describeRange(report: StatsReportHead, f: Formatters, d: Dictionary): string {
  return fill(d.stats.rangeSpan, {
    start: f.dayMonthClock(report.range.from!, report.timezone),
    end: f.dayMonthClock(report.range.to, report.timezone),
  });
}

function perSecond(bytes: number): string {
  return `${formatBytes(bytes, 1)}/s`;
}

function volumeTiles(report: OverviewFigures, { d, f }: Words): Tile[] {
  const { summary, cycle } = report;
  // The series carries each bucket's free-hours part, so the range's share
  // costs no further query. Only said while the free hours are on.
  const freeBytes = cycle.free ? report.series.reduce((sum, p) => sum + p.free_bytes, 0) : 0;
  return [
    {
      label: d.stats.tiles.totalUsed,
      value: formatBytes(summary.total_bytes),
      hint: cycle.free
        ? fill(d.stats.tiles.inFreeHours, { bytes: formatBytes(freeBytes) })
        : fill(d.common.readingsCount, { count: f.count(summary.readings) }),
    },
    {
      label: d.stats.tiles.downloaded,
      value: formatBytes(summary.rx_bytes),
      hint: share(summary.rx_bytes, summary.total_bytes, d),
    },
    {
      label: d.stats.tiles.uploaded,
      value: formatBytes(summary.tx_bytes),
      hint: share(summary.tx_bytes, summary.total_bytes, d),
    },
    {
      label: d.stats.tiles.cycleToDate,
      value: formatBytes(cycle.used_bytes),
      hint: fill(d.stats.tiles.cycleToDateHint, {
        percent: cycle.percent_of_cap.toFixed(0),
        cap: cycle.cap_gb,
      }),
      tone: cycle.over ? "critical" : cycle.percent_of_cap >= 85 ? "warning" : undefined,
    },
  ];
}

function patternTiles(report: PatternFigures, head: StatsReportHead, { d, f }: Words): Tile[] {
  const { summary, peak } = report;
  const busiestHour = report.hours.reduce((best, h) => (h.total_bytes > best.total_bytes ? h : best));
  const busiestDay = report.weekdays.reduce((best, x) => (x.total_bytes > best.total_bytes ? x : best));

  return [
    {
      label: d.stats.tiles.busiestHour,
      value: busiestHour.total_bytes > 0 ? busiestHour.label : d.common.empty,
      hint: busiestHour.total_bytes > 0 ? formatBytes(busiestHour.total_bytes) : d.common.noTrafficYet,
    },
    {
      label: d.stats.tiles.busiestDay,
      value: busiestDay.total_bytes > 0 ? busiestDay.label : d.common.empty,
      hint: busiestDay.total_bytes > 0 ? formatBytes(busiestDay.total_bytes) : d.common.noTrafficYet,
    },
    {
      label: d.stats.tiles.busiestSlot,
      value: peak
        ? `${d.weekdays[peak.weekday - 1]} ${String(peak.hour).padStart(2, "0")}:00`
        : d.common.empty,
      hint: peak ? formatBytes(peak.total_bytes) : d.common.noTrafficYet,
    },
    {
      label: d.stats.tiles.peakThroughput,
      value: perSecond(summary.peak_bytes_per_second),
      hint: d.stats.tiles.peakThroughputHint,
    },
    {
      label: d.stats.tiles.averageThroughput,
      value: perSecond(summary.avg_bytes_per_second),
      hint: fill(d.stats.tiles.averageThroughputHint, {
        duration: f.duration(summary.measured_seconds),
      }),
    },
    {
      label: d.stats.tiles.readingsStored,
      value: f.count(summary.readings),
      hint: summary.last_reading_at
        ? fill(d.stats.tiles.lastReadingAt, {
            time: f.clock(summary.last_reading_at, head.timezone),
          })
        : d.stats.tiles.noneYet,
    },
  ];
}

function reliabilityTiles(report: ReliabilityFigures, { locale, d, f }: Words): Tile[] {
  const s = report.sessions;
  return [
    {
      label: d.stats.tiles.availability,
      value: `${s.availability.toFixed(s.availability >= 99.95 ? 2 : 1)}%`,
      hint: fill(d.common.onlineFor, { duration: f.duration(s.uptime_seconds) }),
      tone: s.availability >= 99 ? "good" : s.availability >= 95 ? "warning" : "critical",
    },
    {
      label: d.stats.tiles.drops,
      value: f.count(s.drops),
      hint:
        s.downtime_seconds > 0
          ? fill(d.common.offlineFor, { duration: f.duration(s.downtime_seconds) })
          : d.common.noGapsRecorded,
      tone: s.drops === 0 ? "good" : undefined,
    },
    {
      label: d.stats.tiles.meanTimeBetweenDrops,
      value: f.duration(s.mtbf_seconds),
      hint: plural(locale, d.stats.tiles.sessionsInRange, s.sessions),
    },
    {
      label: d.stats.tiles.longestSession,
      value: f.duration(s.longest_seconds),
      hint:
        s.sessions > 1
          ? fill(d.stats.tiles.shortestSession, { duration: f.duration(s.shortest_seconds) })
          : d.stats.tiles.onlyOneSession,
    },
  ];
}

function complianceTiles(c: ComplianceSummary, { locale, d, f }: Words): Tile[] {
  return [
    {
      label: d.stats.tiles.daysWithinQuota,
      value: fill(d.stats.tiles.daysWithinQuotaValue, {
        within: c.days_measured - c.days_over,
        measured: c.days_measured,
      }),
      hint: fill(d.stats.tiles.complianceRate, { percent: c.compliance_rate.toFixed(0) }),
      tone: c.days_over === 0 ? "good" : c.compliance_rate >= 80 ? "warning" : "critical",
    },
    {
      label: d.stats.tiles.daysOverQuota,
      value: f.count(c.days_over),
      hint: plural(locale, d.stats.tiles.alertsSent, c.days_alerted),
      tone: c.days_over > 0 ? "critical" : undefined,
    },
    {
      label: d.stats.tiles.averageDay,
      value: formatBytes(c.average_bytes),
      hint: fill(d.stats.tiles.quotaIs, { quota: formatBytes(c.quota_bytes) }),
    },
    {
      label: d.stats.tiles.heaviestDay,
      value: c.worst_day ? formatBytes(c.worst_day.used_bytes) : d.common.empty,
      hint: c.worst_day ? c.worst_day.day : d.stats.tiles.noDaysMeasured,
    },
  ];
}

function freeTiles(free: FreeSummary, { locale, d }: Words): Tile[] {
  return [
    {
      label: d.stats.tiles.freeHours,
      value: formatBytes(free.free_bytes),
      hint:
        free.total_bytes > 0
          ? fill(d.stats.tiles.freeShare, { percent: free.free_share.toFixed(0) })
          : d.common.noTrafficYet,
      tone: free.free_bytes > 0 ? "good" : undefined,
    },
    {
      label: d.stats.tiles.counted,
      value: formatBytes(free.counted_bytes),
      hint: d.stats.tiles.countedHint,
    },
    {
      label: d.stats.tiles.averageFreeDay,
      value: formatBytes(free.average_free_bytes),
      hint:
        free.days_measured > 0
          ? plural(locale, d.stats.tiles.averageFreeDayHint, free.days_measured)
          : d.stats.tiles.noDaysMeasured,
    },
    {
      label: d.stats.tiles.heaviestFreeDay,
      value: free.heaviest ? formatBytes(free.heaviest.free_bytes) : d.common.empty,
      hint: free.heaviest ? free.heaviest.day : d.stats.tiles.noFreeTraffic,
    },
  ];
}

/** "free hours 23:00-06:59", the times kept in clock order in Arabic too. */
function FreeWindowHint({ free, d }: { free: FreeSummary; d: Dictionary }) {
  const [before, after] = d.stats.freeWindowHint.split("{range}");
  return (
    <>
      {before}
      <span dir="ltr">
        {free.window.start}-{free.window.end}
      </span>
      {after}
    </>
  );
}

function share(part: number, whole: number, d: Dictionary): string {
  return whole > 0
    ? fill(d.stats.tiles.shareOfTotal, { percent: ((part / whole) * 100).toFixed(0) })
    : d.common.noTrafficYet;
}
