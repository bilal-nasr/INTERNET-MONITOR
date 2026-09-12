import type { Metadata } from "next";
import { connection } from "next/server";
import { AnomalyList } from "@/components/AnomalyList";
import { RangePicker } from "@/components/RangePicker";
import { Tabs } from "@/components/Tabs";
import { Card, StatTiles, type Tile } from "@/components/stats/chrome";
import { ComplianceChart } from "@/components/stats/ComplianceChart";
import { CycleGauge } from "@/components/stats/CycleGauge";
import { CycleHistoryChart } from "@/components/stats/CycleHistoryChart";
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
} from "@/lib/range";
import { buildStatsReport, type StatsReport } from "@/lib/report";
import { getSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.stats.title} - ${d.meta.appName}` };
}

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

const STATS_VIEWS = ["overview", "patterns", "reliability", "quota"] as const;

function isStatsView(value: unknown): value is (typeof STATS_VIEWS)[number] {
  return typeof value === "string" && (STATS_VIEWS as readonly string[]).includes(value);
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

  const report = await buildStatsReport(settings, range, d);
  // Judged on window-only usage, which is what the compliance chart draws, so a
  // flagged bar and a flagged line describe the same number.
  const anomalies = flagAnomalies(report.compliance.days);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.stats.title}</h1>
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
          charts in a row. */}
      <Tabs
        param="view"
        label={d.stats.tabs.label}
        initial={isStatsView(params.view) ? params.view : "overview"}
        tabs={[
          {
            id: "overview",
            label: d.stats.tabs.overview,
            content: (
              <>
                <StatTiles tiles={volumeTiles(report, w)} />
                <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
                  <Card
                    title={fill(d.stats.trafficOverTime, {
                      bucket: d.buckets[report.range.bucket as BucketUnit],
                    })}
                    hint={fill(d.common.readingsCount, { count: f.count(report.summary.readings) })}
                  >
                    <UsageTimeline
                      series={report.series}
                      bucket={report.range.bucket as BucketUnit}
                      totals={report.summary}
                    />
                  </Card>
                  <Card title={d.stats.downloadAndUpload} hint={d.stats.shareOfTotal}>
                    <TrafficSplitDonut rxBytes={report.summary.rx_bytes} txBytes={report.summary.tx_bytes} />
                  </Card>
                </div>
              </>
            ),
          },
          {
            id: "patterns",
            label: d.stats.tabs.patterns,
            content: (
              <>
                <StatTiles tiles={patternTiles(report, w)} columns={3} />
                <Card title={d.stats.trafficByWeekdayAndHour} hint={d.stats.localTime}>
                  <UsageHeatmap cells={report.heatmap} />
                </Card>
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card title={d.stats.trafficByHour}>
                    <HourProfileChart hours={report.hours} />
                  </Card>
                  <Card title={d.stats.trafficByWeekday}>
                    <WeekdayProfileChart weekdays={report.weekdays} />
                  </Card>
                </div>
              </>
            ),
          },
          {
            id: "reliability",
            label: d.stats.tabs.reliability,
            content: (
              <>
                <StatTiles tiles={reliabilityTiles(report, w)} />
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card title={d.stats.timeOnline} hint={d.stats.timeOnlineHint}>
                    <AvailabilityDonut
                      uptimeSeconds={report.sessions.uptime_seconds}
                      downtimeSeconds={report.sessions.downtime_seconds}
                      availability={report.sessions.availability}
                    />
                  </Card>
                  <Card title={d.stats.sessionLengths}>
                    <DurationChart durations={report.durations} />
                  </Card>
                </div>
                <Card title={d.stats.heaviestSessions} hint={d.stats.topTenByTraffic}>
                  <TopSessionsTable sessions={report.top_sessions} timezone={report.timezone} />
                </Card>
              </>
            ),
          },
          {
            id: "quota",
            label: d.stats.tabs.quota,
            content: (
              <>
                <StatTiles tiles={complianceTiles(report, w)} />
                <Card
                  title={d.stats.dailyUsageInWindow}
                  hint={fill(d.stats.dailyUsageInWindowHint, {
                    start: report.quota.window_start,
                    end: report.quota.window_end,
                    quota: report.quota.daily_gb,
                  })}
                >
                  <ComplianceChart compliance={report.compliance} />
                </Card>
                <AnomalyList flags={anomalies} />
                <CycleGauge cycle={report.cycle} timezone={report.timezone} />
                <Card
                  title={d.stats.consumptionPerCycle}
                  hint={fill(d.stats.cycleStartsOnDay, { day: report.quota.cycle_day })}
                >
                  <CycleHistoryChart cycles={report.cycle_history} capGb={report.quota.monthly_gb} />
                </Card>
              </>
            ),
          },
        ]}
      />

      <p className="text-xs text-muted">{d.stats.methodology}</p>
    </div>
  );
}

function describeRange(report: StatsReport, f: Formatters, d: Dictionary): string {
  return fill(d.stats.rangeSpan, {
    start: f.dayMonthClock(report.range.from!, report.timezone),
    end: f.dayMonthClock(report.range.to, report.timezone),
  });
}

function perSecond(bytes: number): string {
  return `${formatBytes(bytes, 1)}/s`;
}

function volumeTiles(report: StatsReport, { d, f }: Words): Tile[] {
  const { summary, cycle } = report;
  return [
    {
      label: d.stats.tiles.totalUsed,
      value: formatBytes(summary.total_bytes),
      hint: fill(d.common.readingsCount, { count: f.count(summary.readings) }),
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

function patternTiles(report: StatsReport, { d, f }: Words): Tile[] {
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
            time: f.clock(summary.last_reading_at, report.timezone),
          })
        : d.stats.tiles.noneYet,
    },
  ];
}

function reliabilityTiles(report: StatsReport, { locale, d, f }: Words): Tile[] {
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

function complianceTiles(report: StatsReport, { locale, d, f }: Words): Tile[] {
  const c = report.compliance;
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

function share(part: number, whole: number, d: Dictionary): string {
  return whole > 0
    ? fill(d.stats.tiles.shareOfTotal, { percent: ((part / whole) * 100).toFixed(0) })
    : d.common.noTrafficYet;
}
