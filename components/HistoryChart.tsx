"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { useI18n } from "@/components/I18nProvider";
import { chartMargin, valueAxisSide } from "@/components/stats/chrome";
import { bytesToGb, formatBytes } from "@/lib/format";
import { fill, type Dictionary } from "@/lib/i18n";
import type { DailyUsage } from "@/lib/usage";

interface Props {
  history: DailyUsage[];
  quotaGb: number;
  /** Today's date in the configured timezone, as YYYY-MM-DD. */
  today: string;
  days?: number;
  /** Days (YYYY-MM-DD) flagged as unusual; drawn in the warning colour. */
  anomalies?: string[];
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

function makeTooltip(d: Dictionary) {
  return function ChartTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload as DailyUsage & { label: string };
    return (
      <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
        <div className="font-medium">{row.day}</div>
        <div className="mt-1 tabular-nums text-muted">
          {d.common.used}: <span className="text-foreground">{formatBytes(row.used_bytes)}</span>
        </div>
        <div className="tabular-nums text-muted">
          {d.common.readings}: {row.readings}
        </div>
      </div>
    );
  };
}

export function HistoryChart({ history, quotaGb, today, days = 30, anomalies = [] }: Props) {
  const { d, dir, locale } = useI18n();
  const router = useRouter();
  const data = fillDays(history, days, today);
  const hasData = history.some((h) => h.used_bytes > 0);
  const ChartTooltip = makeTooltip(d);
  const flagged = new Set(anomalies);

  // The drill-down as a control a keyboard can reach. A click on a bar is a
  // pointer gesture and nothing else: recharts draws SVG paths, which take no
  // focus and fire no key events, so without these buttons the hourly view
  // below the chart has no route to it at all without a mouse. One tab stop
  // between them all, moved along by the arrow keys, the pattern a toolbar
  // uses; each button shows itself while it holds focus so the caret is never
  // somewhere invisible.
  const [dayIndex, setDayIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const dayRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = Math.min(dayIndex, Math.max(data.length - 1, 0));

  /**
   * A bare date on both ends is the whole local day (lib/range.ts pushes `to`
   * to the next midnight), and an hourly bucket is what a single day reads
   * best in.
   */
  function openDay(day: string) {
    router.push(`/${locale}/stats?range=custom&from=${day}&to=${day}&bucket=hour`);
  }

  function moveTo(next: number) {
    const i = Math.max(0, Math.min(data.length - 1, next));
    setDayIndex(i);
    dayRefs.current[i]?.focus();
  }

  // The bars run oldest to newest whatever the page direction (see chrome.tsx),
  // so the arrow keys follow the drawing, not the script.
  function onDayKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        moveTo(active + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        moveTo(active - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(data.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-muted">
          {fill(d.dashboard.historyHeading, { days })}
        </h2>
        <span className="text-xs text-muted">
          {fill(d.dashboard.historyHint, { quota: quotaGb })}
        </span>
      </div>
      <div className="mt-4 h-64 w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={chartMargin(dir)}
              barCategoryGap={2}
              /* recharts 3 hands a click only the active index, not the row, so
                 the day is read back out of the same filled series the bars are
                 drawn from. A click on empty chart space has no active index. */
              onClick={(state) => {
                if (state.activeIndex == null) return;
                const row = data[Number(state.activeIndex)];
                if (row) openDay(row.day);
              }}
              style={{ cursor: "pointer" }}
            >
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
                orientation={valueAxisSide(dir)}
                tickFormatter={(v: number) => String(v)}
              />
              <Tooltip content={ChartTooltip} cursor={{ fill: "var(--border)", opacity: 0.4 }} />
              <ReferenceLine y={quotaGb} stroke="var(--status-critical)" strokeDasharray="4 4" />
              {/* All bars share one hue because they are whole days while the
                  quota governs only the window; the warning colour is reserved
                  for flagged days. */}
              <Bar dataKey="gb" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                {/* Colour marks state, not identity: a flagged day is out of
                    line with the days before it, and the list under the chart
                    says by how much, so the colour never stands alone. */}
                {data.map((row) => (
                  <Cell
                    key={row.day}
                    fill={flagged.has(row.day) ? "var(--status-warning)" : "var(--series-1)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            {d.dashboard.historyEmpty}
          </div>
        )}
      </div>
      {hasData ? (
        <>
          <ul
            aria-label={d.dashboard.drillHint}
            className="flex flex-wrap gap-1"
            onKeyDown={onDayKeyDown}
          >
            {data.map((row, i) => (
              <li key={row.day}>
                <button
                  type="button"
                  ref={(el) => {
                    dayRefs.current[i] = el;
                  }}
                  tabIndex={i === active ? 0 : -1}
                  onFocus={() => {
                    setDayIndex(i);
                    setFocused(true);
                  }}
                  onBlur={() => setFocused(false)}
                  onClick={() => openDay(row.day)}
                  className={
                    focused && i === active
                      ? "mt-2 rounded-md border border-border bg-surface px-2 py-1 text-xs tabular-nums"
                      : "sr-only"
                  }
                >
                  {row.day} · {formatBytes(row.used_bytes)}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{d.dashboard.drillHint}</p>
        </>
      ) : null}
    </section>
  );
}
