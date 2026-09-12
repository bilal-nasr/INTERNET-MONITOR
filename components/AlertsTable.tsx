import type { ReactNode } from "react";
import type { PublicAlert } from "@/app/api/alerts/route";
import { getI18n } from "@/lib/i18n/server";

const STATUS_CLASS: Record<PublicAlert["status"], string> = {
  sent: "text-green-700 dark:text-status-good",
  failed: "text-status-critical",
  skipped: "text-amber-700 dark:text-status-warning",
};

export async function AlertsTable({ alerts, timezone }: { alerts: PublicAlert[]; timezone: string }) {
  const { d, f } = await getI18n();
  const c = d.alerts.columns;

  if (alerts.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">{d.alerts.empty}</p>
    );
  }

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
    <div>
      {/* Below md the six columns cannot fit, and a sideways-scrolling table
          hides the status and the recipient -- the columns someone opens this
          page to check. Each alert becomes a card instead, as the sessions
          table and the top-sessions table do. */}
      <ul className="space-y-2 md:hidden">
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
              <Pair
                label={c.scope}
                value={
                  <span className="break-all font-mono" dir="ltr">
                    {a.scope_key}
                  </span>
                }
              />
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

      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
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
                <td className="px-4 py-2 font-mono text-xs" dir="ltr">{a.scope_key}</td>
                <td className="px-4 py-2 text-xs" dir="ltr">{a.recipient ?? d.common.empty}</td>
                <td className={`px-4 py-2 ${STATUS_CLASS[a.status]}`} title={a.error ?? undefined}>
                  {status(a)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
