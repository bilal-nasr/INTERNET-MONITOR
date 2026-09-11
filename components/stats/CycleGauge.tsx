import { formatBytes } from "@/lib/format";
import { fill, type Dictionary } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { CycleUsage } from "@/lib/stats";

/**
 * Consumption against the monthly cap, as a ring with a projection marker.
 *
 * Plain SVG rather than a charting library: this also sits on the dashboard,
 * which otherwise ships no chart code at all, and a single arc is not worth a
 * client bundle.
 *
 * Colours here are status, not series: the ring reports a state (comfortable,
 * close to the cap, over it), so each one arrives with its own wording too.
 */

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Tone = "good" | "warning" | "critical";

function toneFor(cycle: CycleUsage): Tone {
  if (cycle.over) return "critical";
  // Being on course to exceed the cap matters as much as already having done so.
  if (cycle.percent_of_cap >= 85 || cycle.projected_percent >= 100) return "warning";
  return "good";
}

const TONE_COLOR: Record<Tone, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  critical: "var(--status-critical)",
};

const TONE_TEXT: Record<Tone, string> = {
  good: "text-green-700 dark:text-status-good",
  warning: "text-amber-700 dark:text-status-warning",
  critical: "text-status-critical",
};

function statusLine(cycle: CycleUsage, tone: Tone, d: Dictionary): string {
  if (tone === "critical") return d.cycle.overCap;
  if (cycle.projected_percent >= 100) return d.cycle.onCourseToExceed;
  if (tone === "warning") return d.cycle.approachingCap;
  return d.cycle.onTrack;
}

export async function CycleGauge({
  cycle,
  timezone,
  compact = false,
}: {
  cycle: CycleUsage;
  timezone: string;
  compact?: boolean;
}) {
  const { d, f } = await getI18n();
  const tone = toneFor(cycle);
  const pct = Math.min(100, Math.max(0, cycle.percent_of_cap));
  const projected = Math.min(100, Math.max(0, cycle.projected_percent));

  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-muted">{d.cycle.heading}</h2>
        <span className="text-xs text-muted">
          {fill(d.cycle.span, {
            start: f.dayMonth(cycle.start, timezone),
            end: f.dayMonth(cycle.end, timezone),
          })}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 sm:gap-6">
        {/* Drawn as SVG at computed coordinates, so the ring fills clockwise
            from the top whichever way the page runs. */}
        <div className="relative size-24 shrink-0 sm:size-32">
          <svg viewBox="0 0 128 128" className="size-full -rotate-90" aria-hidden>
            <circle cx="64" cy="64" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="10" />
            <circle
              cx="64"
              cy="64"
              r={RADIUS}
              fill="none"
              stroke={TONE_COLOR[tone]}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            />
            {/* Where the cycle lands if the current rate holds. */}
            {projected > pct && (
              <circle
                cx="64"
                cy="64"
                r={RADIUS}
                fill="none"
                stroke="var(--muted)"
                strokeWidth="10"
                strokeDasharray={`2 ${CIRCUMFERENCE}`}
                strokeDashoffset={-((projected / 100) * CIRCUMFERENCE)}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-semibold tabular-nums tracking-tight">
              {cycle.percent_of_cap.toFixed(0)}%
            </span>
            <span className="text-[11px] text-muted">{d.cycle.ofCap}</span>
          </div>
        </div>

        <div className="min-w-40 flex-1">
          <div className="text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
            {formatBytes(cycle.used_bytes)}
          </div>
          <div className="text-sm text-muted">{fill(d.cycle.ofCapGb, { cap: cycle.cap_gb })}</div>
          <div className={`mt-1 text-xs font-medium ${TONE_TEXT[tone]}`}>
            {statusLine(cycle, tone, d)}
          </div>
        </div>
      </div>

      <dl
        className={`mt-5 grid gap-x-4 gap-y-3 text-xs sm:gap-x-6 ${
          compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"
        }`}
      >
        <Figure
          label={d.cycle.projected}
          value={formatBytes(cycle.projected_bytes)}
          hint={fill(d.cycle.projectedHint, { percent: cycle.projected_percent.toFixed(0) })}
        />
        <Figure
          label={d.cycle.dailyAverage}
          value={formatBytes(cycle.daily_average_bytes)}
          hint={fill(d.cycle.dailyAverageHint, { days: cycle.days_elapsed })}
        />
        <Figure
          label={d.cycle.dailyBudgetLeft}
          value={formatBytes(cycle.daily_budget_bytes)}
          hint={fill(d.cycle.dailyBudgetHint, { days: cycle.days_remaining })}
        />
        <Figure
          label={d.cycle.remaining}
          value={formatBytes(Math.max(0, cycle.cap_bytes - cycle.used_bytes))}
          hint={cycle.over ? d.cycle.capExceeded : d.cycle.beforeTheCap}
        />
      </dl>
    </section>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
      <dd className="text-muted">{hint}</dd>
    </div>
  );
}
