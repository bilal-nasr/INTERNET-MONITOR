"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { bytesToGb, formatBytes } from "@/lib/format";
import type { DailyUsage } from "@/lib/usage";

interface Props {
  history: DailyUsage[];
  quotaGb: number;
  /** Today's date in the configured timezone, as YYYY-MM-DD. */
  today: string;
  days?: number;
}

/**
 * Fill the requested range so days without readings still show as gaps.
 *
 * The axis is anchored on today, not on the last day that happens to have
 * data. Anchoring on the data would silently shift every bar when the router
 * stops pushing, making stale data look current.
 */
function fillDays(
  history: DailyUsage[],
  days: number,
  today: string,
): (DailyUsage & { label: string; gb: number })[] {
  const byDay = new Map(history.map((h) => [h.day, h]));
  const last = new Date(`${today}T00:00:00Z`);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(last);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    const h = byDay.get(day) ?? { day, readings: 0, min_bytes: 0, max_bytes: 0, used_bytes: 0 };
    out.push({ ...h, label: day.slice(5), gb: bytesToGb(h.used_bytes) });
  }
  return out;
}

function ChartTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as DailyUsage & { label: string };
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-medium">{row.day}</div>
      <div className="mt-1 tabular-nums text-muted">
        Used: <span className="text-foreground">{formatBytes(row.used_bytes)}</span>
      </div>
      <div className="tabular-nums text-muted">Readings: {row.readings}</div>
    </div>
  );
}

export function HistoryChart({ history, quotaGb, today, days = 30 }: Props) {
  const data = fillDays(history, days, today);
  const hasData = history.some((h) => h.used_bytes > 0);

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-muted">Daily usage in GB, last {days} days</h2>
        <span className="text-xs text-muted">all traffic; dashed line = {quotaGb} GB window quota</span>
      </div>
      <div className="mt-4 h-64 w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => String(v)}
              />
              <Tooltip content={ChartTooltip} cursor={{ fill: "var(--border)", opacity: 0.4 }} />
              <ReferenceLine y={quotaGb} stroke="var(--status-critical)" strokeDasharray="4 4" />
              {/* One colour: these bars are the whole day, while the quota only
                  governs the window, so colouring by the quota would mislead. */}
              <Bar
                dataKey="gb"
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
                isAnimationActive={false}
                fill="var(--series-1)"
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            No usage recorded yet. Data appears after a few polls.
          </div>
        )}
      </div>
    </section>
  );
}
