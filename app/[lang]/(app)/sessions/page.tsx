import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OutageCalendar } from "@/components/OutageCalendar";
import { MonitoringGaps } from "@/components/MonitoringGaps";
import { OutageSummary } from "@/components/OutageSummary";
import { RangePicker } from "@/components/RangePicker";
import { SessionsTable, SessionTotalsCards } from "@/components/SessionsTable";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { CauseSegment } from "@/lib/outage-cause";
import { getSilences } from "@/lib/outage-cause-store";
import {
  attachCauses,
  downtimeByDay,
  downtimeSplitByDay,
  downtimeWindowEnd,
  monitoringGaps,
  outagesFromSessions,
  type StoredSilence,
} from "@/lib/outages";
import { DEFAULT_PRESET, InvalidRangeError, rangeErrorMessage, resolveRange, type ResolvedRange } from "@/lib/range";
import {
  getLatestSessionSummary,
  getSessionSpans,
  getSessionsPage,
  getSessionTotals,
  type SessionTotals,
  type SessionWindow,
} from "@/lib/sessions";
import { getSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.nav.sessions} - ${d.meta.appName}` };
}

/** Rows per page of the table. Older pages are fetched as they are asked for. */
const PAGE_SIZE = 10;

/**
 * Most sessions the downtime report reads in one range. Only a guard: it reads
 * four narrow columns per session, and a link would have to drop every hour
 * for seven months to reach it.
 */
const SPAN_LIMIT = 5000;

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export default async function SessionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();

  const { d } = await getI18n();
  const params = await searchParams;
  const settings = await getSettings();
  const options = { timezone: settings.timezone, cycleDay: settings.billing_cycle_day };

  let rangeError: string | null = null;
  let range;
  try {
    range = resolveRange(
      { range: one(params.range) ?? "last_30d", from: one(params.from), to: one(params.to) },
      options,
    );
  } catch (err) {
    if (!(err instanceof InvalidRangeError)) throw err;
    rangeError = rangeErrorMessage(d, err);
    range = resolveRange({ range: DEFAULT_PRESET }, options);
  }

  const window = { from: range.from, to: range.to };
  // Started here and handed down, so the tiles and the section below share one
  // query and each streams in as soon as its own data is ready.
  const totals = getSessionTotals(window);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{d.sessions.title}</h1>
          <p className="text-sm text-muted">
            {fill(d.sessions.subtitle, { timezone: settings.timezone })}
          </p>
        </div>
        <AutoRefresh seconds={20} />
      </div>

      <RangePicker preset={range.preset} from={range.from_input} to={range.to_input} />

      {rangeError && (
        <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm">
          {fill(d.rangePicker.fallback, { reason: rangeError })}
        </p>
      )}

      <Suspense fallback={<TilesSkeleton />}>
        <Totals totals={totals} />
      </Suspense>

      <h2 className="pt-2 text-sm font-semibold tracking-tight">{d.sessions.downtimeHeading}</h2>
      <Suspense fallback={<ReportSkeleton />}>
        <DowntimeAndSessions range={range} window={window} totals={totals} timezone={settings.timezone} />
      </Suspense>
    </div>
  );
}

function rangeKey(range: ResolvedRange): string {
  return [range.preset, range.from_input ?? "", range.to_input ?? ""].join("|");
}

async function Totals({ totals }: { totals: Promise<SessionTotals> }) {
  return <SessionTotalsCards totals={await totals} />;
}

async function DowntimeAndSessions({
  range,
  window,
  totals: totalsPromise,
  timezone,
}: {
  range: ResolvedRange;
  window: SessionWindow;
  totals: Promise<SessionTotals>;
  timezone: string;
}) {
  const { d, f } = await getI18n();
  const [firstPage, spans, totals, latest, silences] = await Promise.all([
    getSessionsPage(window, { limit: PAGE_SIZE }),
    getSessionSpans(window, SPAN_LIMIT),
    totalsPromise,
    // The newest session of all. It only matters when none overlaps the range,
    // which is exactly the case of a link that went down before the range began
    // and has not come back: there is no session to read the outage from, and
    // without this the report would say the link was up the whole time.
    getLatestSessionSummary(),
    // What the router said about each silence in the range (lib/outage-cause.ts).
    // Labels are an addition on top of the sessions the page already shows: if
    // outage_causes has not been migrated in yet, the page must still work,
    // just without them.
    getSilences(window).catch((err): StoredSilence[] => {
      console.warn("[sessions] could not read outage causes", err);
      return [];
    }),
  ]);

  // Downtime, and the share of the range it takes up, are measured up to now
  // and no further: a range may legitimately end in the future.
  const until = downtimeWindowEnd(range.to);

  // Derived from every session in the range, not from the page the table shows.
  const outages = attachCauses(outagesFromSessions(spans, { from: range.from, to: until }, latest), silences);
  const byDay = downtimeByDay(outages, timezone);
  const splitByDay = downtimeSplitByDay(outages, timezone);
  // On a range with more sessions than SPAN_LIMIT, the oldest ones are not read
  // (see the footnote), so a silence from before the oldest one read cannot be
  // told apart from a real monitoring gap; drop it from the gaps input only.
  // attachCauses above still saw every silence.
  const gapsInput =
    spans.length >= SPAN_LIMIT
      ? silences.filter((silence) => silence.silence_from >= spans[spans.length - 1].started_at)
      : silences;
  const gaps = monitoringGaps(gapsInput, outages);
  // Each outage ends where the next session begins, so that session's row shows it.
  const causesBySession: Record<number, CauseSegment[]> = {};
  for (const outage of outages) {
    if (outage.next_session_id !== null && outage.causes.length > 0) {
      causesBySession[outage.next_session_id] = outage.causes;
    }
  }
  const rangeSeconds = range.from
    ? Math.max(0, Math.round((until.getTime() - range.from.getTime()) / 1000))
    : null;

  const rangeQuery = new URLSearchParams({ range: range.preset });
  if (range.from_input) rangeQuery.set("from", range.from_input);
  if (range.to_input) rangeQuery.set("to", range.to_input);

  return (
    <>
      <OutageSummary
        outages={outages}
        betweenSessionsSeconds={totals.downtime_seconds}
        rangeSeconds={rangeSeconds}
        timezone={timezone}
      />
      <OutageCalendar byDay={byDay} splitByDay={splitByDay} from={range.from} to={until} timezone={timezone} />
      <MonitoringGaps gaps={gaps} timezone={timezone} />

      {/* The key starts the table again on page one whenever the range changes. */}
      <SessionsTable
        key={rangeKey(range)}
        first={{ rows: firstPage.sessions, next: firstPage.next_cursor }}
        pageSize={PAGE_SIZE}
        total={totals.sessions}
        rangeQuery={rangeQuery.toString()}
        timezone={timezone}
        causesBySession={causesBySession}
      />

      <p className="text-xs text-muted">{fill(d.sessions.footnote, { limit: f.count(SPAN_LIMIT) })}</p>
    </>
  );
}

function TilesSkeleton() {
  return (
    <div className="grid animate-pulse grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-[5.5rem] rounded-xl border border-border bg-surface" />
      ))}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true">
      <div className="h-28 rounded-xl border border-border bg-surface" />
      <div className="h-48 rounded-xl border border-border bg-surface" />
      <div className="h-96 rounded-xl border border-border bg-surface" />
    </div>
  );
}
