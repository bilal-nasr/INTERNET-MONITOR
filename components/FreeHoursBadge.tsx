import { getI18n } from "@/lib/i18n/server";
import type { TodayUsage } from "@/lib/usage";

/**
 * Says at a glance whether the free hours are running. Green while they are,
 * so nobody wonders why the counters still climb; a quiet outline otherwise,
 * naming the hours so the reader knows when the next free stretch begins.
 */
export async function FreeHoursBadge({ free }: { free: NonNullable<TodayUsage["free"]> }) {
  const { d } = await getI18n();
  return (
    <span
      title={free.active ? d.dashboard.freeNowHint : d.dashboard.freeLaterHint}
      className={`inline-flex items-center gap-1.5 rounded-sm border-[1.5px] px-2 py-0.5 text-xs font-medium ${
        free.active
          ? "border-green-700/50 bg-green-700/8 text-green-800 dark:border-status-good/50 dark:text-status-good"
          : "border-border text-muted"
      }`}
    >
      {free.active && <span aria-hidden className="size-1.5 rounded-full bg-status-good" />}
      {free.active ? d.dashboard.freeNow : d.dashboard.freeLater}
      {/* A clock range reads left to right in both languages. */}
      <span dir="ltr" className="tabular-nums">
        {free.start}-{free.end}
      </span>
    </span>
  );
}
