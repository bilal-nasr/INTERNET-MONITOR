"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Pager, revealTop } from "@/components/Pager";
import { Empty } from "@/components/stats/chrome";
import { formatBytes } from "@/lib/format";
import type { FreeDay } from "@/lib/series";

/** Rows per page, like the other long tables. */
const PAGE_SIZE = 10;

/**
 * One row per day of the range: the free-hours traffic, what the cap counted,
 * and the free part's share of the day.
 *
 * Paged in the browser, by position. A range is at most a few hundred days, and
 * the rows arrive with the page already, so there is no request to page with.
 */
export function FreeDaysTable({ days }: { days: FreeDay[] }) {
  const { d, f } = useI18n();
  const top = useRef<HTMLDivElement>(null);
  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(days.length / PAGE_SIZE));
  // A narrower range can shorten the list under the reader; stay on the last page then.
  const page = Math.min(requestedPage, pageCount - 1);
  const shown = days.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function go(next: number) {
    setPage(next);
    revealTop(top.current);
  }

  if (days.length === 0) {
    return <Empty>{d.charts.noTraffic}</Empty>;
  }

  return (
    <div ref={top} className="scroll-mt-4 space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="py-2 pe-3 text-start font-medium">{d.stats.freeTable.day}</th>
              <th className="py-2 pe-3 text-end font-medium">{d.stats.freeTable.free}</th>
              <th className="py-2 pe-3 text-end font-medium">{d.stats.freeTable.counted}</th>
              <th className="py-2 pe-3 text-end font-medium">{d.common.total}</th>
              <th className="py-2 ps-3 text-end font-medium">{d.stats.freeTable.share}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((day) => {
              // Noon UTC keeps the calendar date whatever the offset of the zone.
              const noon = new Date(`${day.day}T12:00:00Z`);
              const share = day.total_bytes > 0 ? (day.free_bytes / day.total_bytes) * 100 : 0;
              return (
                <tr key={day.day} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap py-2 pe-3 tabular-nums">
                    {d.weekdays[(noon.getUTCDay() + 6) % 7]} {f.dayMonth(noon.toISOString(), "UTC")}
                  </td>
                  <td className="py-2 pe-3 text-end font-medium tabular-nums">{formatBytes(day.free_bytes)}</td>
                  <td className="py-2 pe-3 text-end tabular-nums">{formatBytes(day.counted_bytes)}</td>
                  <td className="py-2 pe-3 text-end tabular-nums text-muted">{formatBytes(day.total_bytes)}</td>
                  <td className="py-2 ps-3">
                    {/* The bar repeats the share as length, so heavy free days stand out down the column. */}
                    <div className="flex items-center justify-end gap-3">
                      <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-border sm:block">
                        <div className="h-full rounded-full bg-series-3" style={{ width: `${share}%` }} />
                      </div>
                      <span className="w-10 text-end tabular-nums">{share.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager
        start={page * PAGE_SIZE + 1}
        end={page * PAGE_SIZE + shown.length}
        total={days.length}
        hasPrevious={page > 0}
        hasNext={page < pageCount - 1}
        onFirst={() => go(0)}
        onPrevious={() => go(page - 1)}
        onNext={() => go(page + 1)}
        order="time"
      />
    </div>
  );
}
