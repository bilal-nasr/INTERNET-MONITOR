import Link from "next/link";
import { Empty } from "@/components/stats/chrome";
import { formatBytes } from "@/lib/format";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { TopSession } from "@/lib/stats";

/**
 * The heaviest sessions in the range, each with a bar showing its share.
 *
 * A table from sm up; below that the five columns become a stacked card, since
 * a table narrow enough for a phone would have to drop the very figures the
 * ranking is based on.
 */
export async function TopSessionsTable({
  sessions,
  timezone,
}: {
  sessions: TopSession[];
  timezone: string;
}) {
  const { locale, d, f } = await getI18n();

  if (sessions.length === 0) {
    return <Empty>{d.charts.noSessions}</Empty>;
  }

  const max = Math.max(...sessions.map((s) => s.total_bytes), 1);

  return (
    <div>
      <ul className="space-y-3 sm:hidden">
        {sessions.map((s) => (
          <li key={s.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="tabular-nums">{f.dayMonthClock(s.started_at, timezone)}</span>
              <span className="font-medium tabular-nums">{formatBytes(s.total_bytes)}</span>
            </div>
            <ShareBar bytes={s.total_bytes} max={max} className="mt-1.5 max-w-none" />
            <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-muted">
              <span>{fill(d.sessions.upShort, { duration: f.duration(s.uptime_seconds) })}</span>
              <span className="tabular-nums">
                {fill(d.sessions.downBytes, { bytes: formatBytes(s.rx_bytes) })}
              </span>
              <span className="tabular-nums">
                {fill(d.sessions.upBytes, { bytes: formatBytes(s.tx_bytes) })}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b border-border text-start text-xs text-muted">
            <th className="py-2 pe-3 text-start font-medium">{d.sessions.opened}</th>
            <th className="py-2 pe-3 text-start font-medium">{d.sessions.uptime}</th>
            <th className="py-2 pe-3 text-end font-medium">{d.common.download}</th>
            <th className="py-2 pe-3 text-end font-medium">{d.common.upload}</th>
            <th className="py-2 ps-3 text-end font-medium">{d.common.total}</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-b border-border/60 last:border-0">
              <td className="py-2 pe-3 tabular-nums">{f.dayMonthClock(s.started_at, timezone)}</td>
              <td className="py-2 pe-3 tabular-nums text-muted">{f.duration(s.uptime_seconds)}</td>
              <td className="py-2 pe-3 text-end tabular-nums">{formatBytes(s.rx_bytes)}</td>
              <td className="py-2 pe-3 text-end tabular-nums">{formatBytes(s.tx_bytes)}</td>
              <td className="py-2 ps-3">
                {/* The bar repeats the total as length, so the ranking reads at
                    a glance without comparing numbers down the column. */}
                <div className="flex items-center justify-end gap-3">
                  <ShareBar bytes={s.total_bytes} max={max} className="hidden lg:block" />
                  <span className="w-20 text-end font-medium tabular-nums">
                    {formatBytes(s.total_bytes)}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-xs text-muted">
        {d.sessions.topFootnote}{" "}
        <Link href={`/${locale}/sessions`} className="underline">
          {d.sessions.allSessions}
        </Link>
      </p>
    </div>
  );
}

function ShareBar({
  bytes,
  max,
  className = "",
}: {
  bytes: number;
  max: number;
  className?: string;
}) {
  return (
    <div className={`h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-border ${className}`}>
      <div
        className="h-full rounded-full bg-series-1"
        style={{ width: `${(bytes / max) * 100}%` }}
      />
    </div>
  );
}
