import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { DayDowntime } from "@/lib/outages";
import { localParts } from "@/lib/time";

/** Beyond this many days the cells are too small to read; the tiles still show. */
export const CALENDAR_MAX_DAYS = 92;

/**
 * Six steps of the sequential ramp from app/globals.css, chosen by how long
 * the link was down: the same bands the session-length chart uses, so a
 * reader who knows one knows the other.
 */
function level(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds < 300) return 1;
  if (seconds < 1800) return 2;
  if (seconds < 7200) return 3;
  if (seconds < 21600) return 4;
  if (seconds < 86400) return 5;
  return 6;
}

/** Every local date from `from` up to but not including the day after `to`. */
function daysBetween(from: Date, to: Date, timezone: string): string[] {
  const out: string[] = [];
  const first = localParts(from, timezone).date;
  const last = localParts(new Date(to.getTime() - 1), timezone).date;
  const [y, m, d] = first.split("-").map(Number);
  for (let i = 0; i <= CALENDAR_MAX_DAYS; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    out.push(day);
    if (day >= last) break;
  }
  return out;
}

export async function OutageCalendar({
  byDay,
  from,
  to,
  timezone,
}: {
  byDay: DayDowntime[];
  from: Date | null;
  to: Date;
  timezone: string;
}) {
  const { d, f } = await getI18n();
  const s = d.sessions;

  const days = from ? daysBetween(from, to, timezone) : [];
  const tooLong = !from || days.length > CALENDAR_MAX_DAYS;
  const bySeconds = new Map(byDay.map((row) => [row.day, row]));

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-muted">{s.calendarHeading}</h2>
        <span className="text-xs text-muted">{s.calendarHint}</span>
      </div>
      {tooLong ? (
        <p className="mt-4 text-sm text-muted">{fill(s.calendarTooLong, { max: CALENDAR_MAX_DAYS })}</p>
      ) : (
        // The grid runs oldest to newest in reading order; dir="ltr" keeps a
        // time axis from reversing on the Arabic page (see chrome.tsx).
        <ul
          dir="ltr"
          className="mt-4 grid grid-cols-7 gap-1 sm:grid-cols-14 lg:grid-cols-[repeat(23,minmax(0,1fr))]"
        >
          {days.map((day) => {
            const row = bySeconds.get(day);
            const seconds = row?.seconds ?? 0;
            const lvl = level(seconds);
            const title =
              seconds > 0
                ? fill(s.calendarCell, { day, duration: f.duration(seconds) })
                : fill(s.calendarCellNone, { day });
            return (
              <li
                key={day}
                title={title}
                aria-label={title}
                className="aspect-square rounded-[3px] border border-border text-[9px] leading-none text-muted"
                style={{ background: lvl === 0 ? "var(--surface)" : `var(--scale-${lvl})` }}
              >
                <span className="sr-only">{title}</span>
                <span aria-hidden className="block p-0.5 tabular-nums">
                  {day.slice(8)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
