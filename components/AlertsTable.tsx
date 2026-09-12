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

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
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
                {d.alerts.statuses[a.status]}
                {a.status === "skipped" && (
                  <span className="block text-xs font-normal text-muted">{d.alerts.skippedReason}</span>
                )}
                {a.status === "failed" && a.error && (
                  <span className="block max-w-xs truncate text-xs font-normal text-muted">{a.error}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
