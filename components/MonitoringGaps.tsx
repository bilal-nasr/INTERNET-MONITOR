import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { dominantCause } from "@/lib/outage-cause";
import type { StoredSilence } from "@/lib/outages";

/** The list is otherwise unbounded; show only the newest ones. */
const MAX_GAPS = 20;

/**
 * Silences that are not downtime (lib/outages.ts monitoringGaps), newest
 * first. Renders nothing when there are none, which is the usual case.
 */
export async function MonitoringGaps({ gaps, timezone }: { gaps: StoredSilence[]; timezone: string }) {
  if (gaps.length === 0) return null;
  const { d, f } = await getI18n();
  const s = d.sessions;

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-muted">{s.gapsHeading}</h2>
        <span className="text-xs text-muted">{s.gapsHint}</span>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {[...gaps]
          .reverse()
          .slice(0, MAX_GAPS)
          .map((gap) => {
            const seconds = Math.round((Date.parse(gap.silence_to) - Date.parse(gap.silence_from)) / 1000);
            return (
              <li key={gap.silence_from} className="tabular-nums">
                {fill(s.gapRow, {
                  cause: s.causes[dominantCause(gap.segments)],
                  duration: f.duration(seconds),
                  time: f.stamp(gap.silence_from, timezone),
                })}
              </li>
            );
          })}
      </ul>
    </section>
  );
}
