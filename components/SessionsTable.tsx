"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/components/I18nProvider";
import { formatBytes } from "@/lib/format";
import { fill, plural, type Dictionary } from "@/lib/i18n";
import type { SessionSummary, SessionTotals } from "@/lib/sessions";
import type { SelectedSessionTotals } from "@/lib/stats";

/** Ten missed pushes at the default interval. */
const SILENT_AFTER_SECONDS = 300;

function Cell({ iso, timeZone }: { iso: string | null; timeZone: string }) {
  const { d, f } = useI18n();
  if (!iso) return <span className="text-muted">{d.common.empty}</span>;
  // A gap rather than a margin: a margin has a side, and which side that lands
  // on inside a right-to-left line depends on how the bidi algorithm orders the
  // number against the Arabic month beside it. A flex gap is always between.
  return (
    <span className="inline-flex items-baseline gap-2 tabular-nums">
      <span>{f.clockWithSeconds(iso, timeZone)}</span>
      <span className="text-xs text-muted">{f.dayMonth(iso, timeZone)}</span>
    </span>
  );
}

export function SessionTotalsCards({ totals }: { totals: SessionTotals }) {
  const { locale, d, f } = useI18n();
  const tiles = [
    {
      label: d.sessions.totalConsumed,
      value: formatBytes(totals.total_bytes),
      hint: plural(locale, d.sessions.sessionsCount, totals.sessions),
    },
    { label: d.common.download, value: formatBytes(totals.rx_bytes), hint: d.sessions.receivedOnWan },
    { label: d.common.upload, value: formatBytes(totals.tx_bytes), hint: d.sessions.sentOnWan },
    {
      label: d.sessions.linkUp,
      value: f.duration(totals.uptime_seconds),
      hint:
        totals.downtime_seconds > 0
          ? fill(d.common.offlineFor, { duration: f.duration(totals.downtime_seconds) })
          : d.common.noGapsRecorded,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-border bg-surface p-3 sm:p-4">
          <div className="text-xs text-muted">{t.label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">
            {t.value}
          </div>
          <div className="mt-0.5 text-xs text-muted">{t.hint}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The sessions table, with row selection.
 *
 * Selected totals are fetched from /api/sessions/totals rather than summed in
 * the browser. The browser holds every visible row's counters, so summing here
 * would be easy, but it would only ever total what the table happens to be
 * showing: asking the database keeps a selection exact and keeps one definition
 * of "total" for the whole application.
 */
export function SessionsTable({
  sessions,
  timezone,
}: {
  sessions: SessionSummary[];
  timezone: string;
}) {
  const { locale, d, f } = useI18n();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const visibleIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

  // Totals cover only the rows actually on screen. Narrowing here rather than
  // pruning the stored set means a row that leaves and returns, as it does on
  // every auto-refresh, comes back still selected.
  const selectedVisible = useMemo(
    () => visibleIds.filter((id) => selected.has(id)),
    [visibleIds, selected],
  );

  const toggle = useCallback((id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = sessions.length > 0 && selectedVisible.length === sessions.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
        {d.sessions.empty}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SelectionSummary ids={selectedVisible} onClear={() => setSelected(new Set())} />

      <label className="flex items-center gap-2 text-xs text-muted md:hidden">
        <SelectAll
          checked={allSelected}
          indeterminate={someSelected}
          onChange={(checked) => setSelected(checked ? new Set(visibleIds) : new Set())}
        />
        {plural(locale, d.sessions.selectAll, sessions.length)}
      </label>

      {/* Below md the nine columns cannot fit, and a sideways-scrolling table
          hides exactly the traffic figures the page exists to show. Each
          session becomes a card instead, with the same selection behaviour. */}
      <ul className="space-y-2 md:hidden">
        {sessions.map((s) => {
          const checked = selected.has(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => toggle(s.id)}
                aria-pressed={checked}
                className={`w-full rounded-xl border p-4 text-start transition-colors ${
                  checked ? "border-series-1/50 bg-series-1/5" : "border-border bg-surface"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                      checked ? "border-series-1 bg-series-1 text-white" : "border-border"
                    }`}
                  >
                    {checked ? "✓" : ""}
                  </span>
                  <Status session={s} />
                  <span className="ms-auto font-semibold tabular-nums">
                    {formatBytes(s.total_bytes)}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <Pair label={d.sessions.opened} value={<Cell iso={s.started_at} timeZone={timezone} />} />
                  <Pair label={d.sessions.closed} value={<Cell iso={s.ended_at} timeZone={timezone} />} />
                  <Pair label={d.sessions.uptime} value={f.duration(s.uptime_seconds)} />
                  <Pair
                    label={d.sessions.offlineBefore}
                    value={
                      s.downtime_before_seconds === null
                        ? d.common.empty
                        : f.duration(s.downtime_before_seconds)
                    }
                  />
                  <Pair label={d.common.download} value={formatBytes(s.rx_bytes)} />
                  <Pair label={d.common.upload} value={formatBytes(s.tx_bytes)} />
                </dl>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full min-w-[58rem] text-sm">
          <thead>
            <tr className="border-b border-border text-start text-xs text-muted">
              <th className="w-10 px-4 py-3">
                <SelectAll
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(checked) => setSelected(checked ? new Set(visibleIds) : new Set())}
                />
              </th>
              <th className="px-4 py-3 text-start font-medium">{d.common.status}</th>
              <th className="px-4 py-3 text-start font-medium">{d.sessions.opened}</th>
              <th className="px-4 py-3 text-start font-medium">{d.sessions.closed}</th>
              <th className="px-4 py-3 text-end font-medium">{d.sessions.uptime}</th>
              <th className="px-4 py-3 text-end font-medium">{d.sessions.offlineBefore}</th>
              <th className="px-4 py-3 text-end font-medium">{d.common.download}</th>
              <th className="px-4 py-3 text-end font-medium">{d.common.upload}</th>
              <th className="px-4 py-3 text-end font-medium">{d.common.total}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const checked = selected.has(s.id);
              return (
                <tr
                  key={s.id}
                  onClick={() => toggle(s.id)}
                  className={`cursor-pointer border-b border-border/60 last:border-0 ${
                    checked ? "bg-series-1/8" : "hover:bg-border/30"
                  }`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(s.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={fill(d.sessions.includeInTotal, {
                        time: f.dayMonthClock(s.started_at, timezone),
                      })}
                      className="size-4 accent-[var(--series-1)]"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Status session={s} />
                  </td>
                  <td className="px-4 py-3">
                    <Cell iso={s.started_at} timeZone={timezone} />
                  </td>
                  <td className="px-4 py-3">
                    <Cell iso={s.ended_at} timeZone={timezone} />
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">{f.duration(s.uptime_seconds)}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted">
                    {s.downtime_before_seconds === null
                      ? d.common.empty
                      : f.duration(s.downtime_before_seconds)}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">{formatBytes(s.rx_bytes)}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{formatBytes(s.tx_bytes)}</td>
                  <td className="px-4 py-3 text-end font-medium tabular-nums">
                    {formatBytes(s.total_bytes)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Status({ session }: { session: SessionSummary }) {
  const { d, f } = useI18n();

  if (session.open && session.seconds_since_seen <= SILENT_AFTER_SECONDS) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-status-good/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-status-good">
        <span className="size-1.5 rounded-full bg-status-good" />
        {d.sessions.live}
      </span>
    );
  }
  if (session.open) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-status-critical/15 px-2 py-0.5 text-xs font-medium text-status-critical"
        title={fill(d.sessions.nothingHeardFor, {
          duration: f.duration(session.seconds_since_seen),
        })}
      >
        &#9888; {d.sessions.noContact}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted">
      {session.end_reason === "restart" ? d.sessions.dropped : d.sessions.closedStatus}
    </span>
  );
}

function SelectAll({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { d } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={d.sessions.selectEveryShown}
      className="size-4 accent-[var(--series-1)]"
    />
  );
}

const EMPTY_TOTALS: SelectedSessionTotals = {
  sessions: 0,
  tx_bytes: 0,
  rx_bytes: 0,
  total_bytes: 0,
  uptime_seconds: 0,
  first_started_at: null,
  last_ended_at: null,
  matched_ids: [],
};

/**
 * The result is stored alongside the selection it describes, so a result for an
 * earlier selection is never shown against a newer one; that also keeps the
 * fetch effect free of any synchronous state update.
 */
interface TotalsResult {
  key: string;
  totals: SelectedSessionTotals | null;
  error: string | null;
}

function SelectionSummary({ ids, onClear }: { ids: number[]; onClear: () => void }) {
  const { locale, d, f } = useI18n();
  const [result, setResult] = useState<TotalsResult | null>(null);
  const key = ids.join(",");

  useEffect(() => {
    if (key === "") return;

    const controller = new AbortController();
    fetch(`/api/sessions/totals?ids=${encodeURIComponent(key)}&lang=${locale}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readMessage(res, d));
        return (await res.json()) as SelectedSessionTotals;
      })
      .then((totals) => setResult({ key, totals, error: null }))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setResult({ key, totals: null, error: err.message });
      });

    return () => controller.abort();
  }, [key, locale, d]);

  const current = result?.key === key ? result : null;
  const totals = current?.totals ?? EMPTY_TOTALS;
  const error = current?.error ?? null;
  const pending = current === null;

  if (ids.length === 0) {
    return <p className="text-xs text-muted">{d.sessions.selectHint}</p>;
  }

  return (
    <div className="rounded-xl border border-series-1/40 bg-series-1/5 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="text-sm font-medium">
          {plural(locale, d.sessions.selectedCount, ids.length)}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="ms-auto rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-border/60 hover:text-foreground"
        >
          {d.common.clear}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:flex sm:flex-wrap sm:gap-x-6">
        {error ? (
          <span className="text-sm text-status-critical">
            {fill(d.sessions.totalsFailed, { reason: error })}
          </span>
        ) : pending ? (
          <span className="text-sm text-muted">{d.sessions.totalling}</span>
        ) : (
          <>
            <Figure label={d.common.total} value={formatBytes(totals.total_bytes)} strong />
            <Figure label={d.common.download} value={formatBytes(totals.rx_bytes)} />
            <Figure label={d.common.upload} value={formatBytes(totals.tx_bytes)} />
            <Figure label={d.sessions.timeOnline} value={f.duration(totals.uptime_seconds)} />
          </>
        )}
      </div>
    </div>
  );
}

/** The route answers in the language asked for, so its message is used as-is. */
async function readMessage(res: Response, d: Dictionary): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.message === "string") return body.message;
  } catch {
    // Fall through to the status line below.
  }
  return fill(d.settings.httpError, { status: res.status });
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="text-sm">
      <span className="text-xs text-muted">{label} </span>
      <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
