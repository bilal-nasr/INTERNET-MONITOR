import { formatBytes } from "@/lib/format";
import type { SessionSummary, SessionTotals } from "@/lib/sessions";
import { formatDuration } from "@/lib/time";

/** Ten missed pushes at the default interval. */
const SILENT_AFTER_SECONDS = 300;

function dateTime(iso: string, timeZone: string): { day: string; time: string } {
  const d = new Date(iso);
  return {
    day: new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "short" }).format(d),
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(d),
  };
}

function Cell({ iso, timeZone }: { iso: string | null; timeZone: string }) {
  if (!iso) return <span className="text-muted">-</span>;
  const { day, time } = dateTime(iso, timeZone);
  return (
    <span className="tabular-nums">
      {time}
      <span className="ml-2 text-xs text-muted">{day}</span>
    </span>
  );
}

export function SessionTotalsCards({ totals }: { totals: SessionTotals }) {
  const tiles = [
    { label: "Total consumed", value: formatBytes(totals.total_bytes), hint: `${totals.sessions} sessions` },
    { label: "Downloaded", value: formatBytes(totals.rx_bytes), hint: "received on the WAN link" },
    { label: "Uploaded", value: formatBytes(totals.tx_bytes), hint: "sent on the WAN link" },
    {
      label: "Link up",
      value: formatDuration(totals.uptime_seconds),
      hint: totals.downtime_seconds > 0 ? `${formatDuration(totals.downtime_seconds)} offline` : "no gaps recorded",
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-border bg-surface p-4">
          <div className="text-xs text-muted">{t.label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{t.value}</div>
          <div className="mt-0.5 text-xs text-muted">{t.hint}</div>
        </div>
      ))}
    </div>
  );
}

export function SessionsTable({
  sessions,
  timezone,
}: {
  sessions: SessionSummary[];
  timezone: string;
}) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
        No sessions recorded yet. They appear once the router script posts its first reading.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[54rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Opened</th>
            <th className="px-4 py-3 font-medium">Closed</th>
            <th className="px-4 py-3 text-right font-medium">Uptime</th>
            <th className="px-4 py-3 text-right font-medium">Offline before</th>
            <th className="px-4 py-3 text-right font-medium">Download</th>
            <th className="px-4 py-3 text-right font-medium">Upload</th>
            <th className="px-4 py-3 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-3">
                {s.open && s.seconds_since_seen <= SILENT_AFTER_SECONDS && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-status-good/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-status-good">
                    <span className="size-1.5 rounded-full bg-status-good" />
                    Live
                  </span>
                )}
                {s.open && s.seconds_since_seen > SILENT_AFTER_SECONDS && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full bg-status-critical/15 px-2 py-0.5 text-xs font-medium text-status-critical"
                    title={`Nothing heard for ${formatDuration(s.seconds_since_seen)}`}
                  >
                    &#9888; No contact
                  </span>
                )}
                {!s.open && (
                  <span className="text-xs text-muted">
                    {s.end_reason === "restart" ? "Dropped" : "Closed"}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <Cell iso={s.started_at} timeZone={timezone} />
              </td>
              <td className="px-4 py-3">
                <Cell iso={s.ended_at} timeZone={timezone} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatDuration(s.uptime_seconds)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted">
                {s.downtime_before_seconds === null ? "-" : formatDuration(s.downtime_before_seconds)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatBytes(s.rx_bytes)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatBytes(s.tx_bytes)}</td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">{formatBytes(s.total_bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
