import type { Metadata } from "next";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { RangePicker } from "@/components/RangePicker";
import { SessionsTable, SessionTotalsCards } from "@/components/SessionsTable";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { DEFAULT_PRESET, InvalidRangeError, rangeErrorMessage, resolveRange } from "@/lib/range";
import { getSessions, getSessionTotals } from "@/lib/sessions";
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
  const [sessions, totals] = await Promise.all([
    getSessions(window, LIMIT),
    getSessionTotals(window),
  ]);

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

      <SessionsTable sessions={sessions} timezone={settings.timezone} />

      <p className="text-xs text-muted">{fill(d.sessions.footnote, { limit: LIMIT })}</p>
    </div>
  );
}
