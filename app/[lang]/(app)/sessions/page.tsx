import type { Metadata } from "next";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OutageCalendar } from "@/components/OutageCalendar";
import { OutageSummary } from "@/components/OutageSummary";
import { RangePicker } from "@/components/RangePicker";
import { SessionsTable, SessionTotalsCards } from "@/components/SessionsTable";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { downtimeByDay, downtimeWindowEnd, outagesFromSessions } from "@/lib/outages";
import { DEFAULT_PRESET, InvalidRangeError, rangeErrorMessage, resolveRange } from "@/lib/range";
import { getLatestSessionSummary, getSessions, getSessionTotals } from "@/lib/sessions";
import { getSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.nav.sessions} - ${d.meta.appName}` };
}

/** One page of rows; selecting them all still totals in the database. */
const LIMIT = 200;

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
  const [sessions, totals, latest] = await Promise.all([
    getSessions(window, LIMIT),
    getSessionTotals(window),
    // The newest session of all. It only matters when none overlaps the range,
    // which is exactly the case of a link that went down before the range began
    // and has not come back: there is no session to read the outage from, and
    // without this the report would say the link was up the whole time.
    getLatestSessionSummary(),
  ]);

  // Downtime, and the share of the range it takes up, are measured up to now
  // and no further: a range may legitimately end in the future.
  const until = downtimeWindowEnd(range.to);

  // Derived from the sessions already fetched, so the report costs no extra
  // round trip. It is bounded by LIMIT like the table: on a range with more
  // than LIMIT sessions the oldest gaps are not shown, which the footnote says.
  const outages = outagesFromSessions(sessions, { from: range.from, to: until }, latest);
  const byDay = downtimeByDay(outages, settings.timezone);
  const rangeSeconds = range.from
    ? Math.max(0, Math.round((until.getTime() - range.from.getTime()) / 1000))
    : null;

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

      <SessionTotalsCards totals={totals} />

      <h2 className="pt-2 text-sm font-semibold tracking-tight">{d.sessions.downtimeHeading}</h2>
      <OutageSummary
        outages={outages}
        betweenSessionsSeconds={totals.downtime_seconds}
        rangeSeconds={rangeSeconds}
        timezone={settings.timezone}
      />
      <OutageCalendar byDay={byDay} from={range.from} to={until} timezone={settings.timezone} />

      <SessionsTable sessions={sessions} timezone={settings.timezone} />

      <p className="text-xs text-muted">{fill(d.sessions.footnote, { limit: LIMIT })}</p>
    </div>
  );
}
