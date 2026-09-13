"use client";

import { useRef, type ReactNode } from "react";
import type { PublicAlert } from "@/app/api/alerts/route";
import { useI18n } from "@/components/I18nProvider";
import { Pager, revealTop } from "@/components/Pager";
import { useKeysetPages, type KeysetPage } from "@/components/useKeysetPages";
import { fill } from "@/lib/i18n";

const STATUS_CLASS: Record<PublicAlert["status"], string> = {
  sent: "text-green-700 dark:text-status-good",
  failed: "text-status-critical",
  skipped: "text-amber-700 dark:text-status-warning",
};

/**
 * The alert log, newest first, one page at a time. The first page comes from
 * the server with every refresh; older pages are fetched from /api/alerts by
 * cursor when asked for (components/useKeysetPages.ts).
 */
export function AlertsTable({
  first,
  pageSize,
  total,
  timezone,
}: {
  first: KeysetPage<PublicAlert>;
  pageSize: number;
  total: number;
  timezone: string;
}) {
  const { locale, d, f } = useI18n();
  const c = d.alerts.columns;
  const top = useRef<HTMLDivElement>(null);

  const pages = useKeysetPages<PublicAlert>({
    first,
    pageSize,
    onPageChange: () => revealTop(top.current),
    load: async (cursor, signal) => {
      const res = await fetch(`/api/alerts?limit=${pageSize}&before=${cursor}&lang=${locale}`, {
        signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? fill(d.settings.httpError, { status: res.status }));
      }
      const body = (await res.json()) as { alerts: PublicAlert[]; next_cursor: number | null };
      return { rows: body.alerts, next: body.next_cursor };
    },
  });
  const alerts = pages.rows;

  if (alerts.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">{d.alerts.empty}</p>
    );
  }

  /**
   * What the alert was about, in words. The stored scope key is the dedupe key
   * the sender used: a local date for a daily alert, the cycle's first day for
   * a monthly one, `digest:<date>` for a digest and `link` for the router link.
   * Anything unrecognised is shown as stored rather than dropped.
   */
  const about = (a: PublicAlert): string => {
    const date = /(\d{4}-\d{2}-\d{2})$/.exec(a.scope_key)?.[1];
    const day = date ? f.dayMonth(`${date}T12:00:00Z`, "UTC") : null;
    if (a.kind === "link_stale" || a.kind === "link_recovered") return d.alerts.scopes.link;
    if (!day) return a.scope_key;
    if (a.kind === "cycle_threshold" || a.kind === "cycle_pace") return fill(d.alerts.scopes.cycle, { date: day });
    return day;
  };

  /** The status word and, for a skip or a failure, the reason under it. */
  const status = (a: PublicAlert) => (
    <>
      {d.alerts.statuses[a.status]}
      {a.status === "skipped" && (
        <span className="block text-xs font-normal text-muted">{d.alerts.skippedReason}</span>
      )}
      {a.status === "failed" && a.error && (
        <span className="block max-w-xs truncate text-xs font-normal text-muted">{a.error}</span>
      )}
    </>
  );

  // One element, as before, so the page's spacing between its children does
  // not change with the breakpoint.
  return (
    <div ref={top} className="scroll-mt-4 space-y-4">
      {/* Below md the six columns cannot fit, and a sideways-scrolling table
          hides the status and the recipient -- the columns someone opens this
          page to check. Each alert becomes a card instead, as the sessions
          table and the top-sessions table do. */}
      <ul className={`space-y-2 transition-opacity md:hidden ${pages.pending ? "opacity-60" : ""}`}>
        {alerts.map((a) => (
          <li key={a.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{d.alerts.kinds[a.kind]}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-muted">
                {f.stamp(a.created_at, timezone)}
              </span>
            </div>
            <div className={`mt-1 ${STATUS_CLASS[a.status]}`} title={a.error ?? undefined}>
              {status(a)}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Pair label={c.level} value={a.level === null ? d.common.empty : `${a.level}%`} />
              <Pair label={c.scope} value={about(a)} />
              <Pair
                className="col-span-2"
                label={c.recipient}
                value={
                  <span className="break-all" dir="ltr">
                    {a.recipient ?? d.common.empty}
                  </span>
                }
              />
            </dl>
          </li>
        ))}
      </ul>

      <div
        className={`hidden overflow-x-auto rounded-xl border border-border bg-surface transition-opacity md:block ${
          pages.pending ? "opacity-60" : ""
        }`}
      >
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-start font-medium">{c.when}</th>
              <th className="px-4 py-2 text-start font-medium">{c.kind}</th>
              <th className="px-4 py-2 text-start font-medium">{c.level}</th>
              <th className="px-4 py-2 text-start font-medium">{c.scope}</th>
              <th className="px-4 py-2 text-start font-medium">{c.recipient}</th>
              <th className="px-4 py-2 text-start font-medium">{c.status}</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-4 py-2 tabular-nums">{f.stamp(a.created_at, timezone)}</td>
                <td className="px-4 py-2">{d.alerts.kinds[a.kind]}</td>
                <td className="px-4 py-2 tabular-nums">{a.level === null ? d.common.empty : `${a.level}%`}</td>
                <td className="whitespace-nowrap px-4 py-2 tabular-nums" title={a.scope_key}>
                  {about(a)}
                </td>
                <td className="px-4 py-2 text-xs" dir="ltr">{a.recipient ?? d.common.empty}</td>
                <td className={`px-4 py-2 ${STATUS_CLASS[a.status]}`} title={a.error ?? undefined}>
                  {status(a)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager
        order="time"
        start={pages.start}
        end={pages.end}
        total={total}
        hasPrevious={pages.hasNewer}
        hasNext={pages.hasOlder}
        onFirst={pages.newest}
        onPrevious={pages.newer}
        onNext={pages.older}
        pending={pages.pending}
        error={pages.error}
      />
    </div>
  );
}

function Pair({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
