import type { ReactNode } from "react";
import type { Direction } from "@/lib/i18n/config";

/**
 * The pieces every panel on the statistics page is built from: a card, a stat
 * tile, a legend and an empty state. Kept together so the page has one visual
 * grammar rather than a dozen slightly different boxes.
 */

export function Card({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export interface Tile {
  label: string;
  value: string;
  hint?: string;
  /** Tints the value. Reserved for genuine state, never for series identity. */
  tone?: "good" | "warning" | "critical";
}

const TONES: Record<NonNullable<Tile["tone"]>, string> = {
  good: "text-green-700 dark:text-status-good",
  warning: "text-amber-700 dark:text-status-warning",
  critical: "text-status-critical",
};

export function StatTiles({ tiles, columns = 4 }: { tiles: Tile[]; columns?: 3 | 4 }) {
  // Two across even on the narrowest phone: one per row turns four figures
  // into a column the reader has to scroll past to reach the charts.
  const grid = columns === 3 ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-2 lg:grid-cols-4";
  return (
    <div className={`grid gap-3 sm:gap-4 ${grid}`}>
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-border bg-surface p-3 sm:p-4">
          <div className="text-xs text-muted">{t.label}</div>
          <div
            className={`mt-1 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl ${
              t.tone ? TONES[t.tone] : ""
            }`}
          >
            {t.value}
          </div>
          {t.hint ? <div className="mt-0.5 text-xs text-muted">{t.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  value?: string;
}

/** Always shown for two or more series, so identity never rests on colour alone. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{ background: item.color }}
          />
          <span className="text-muted">{item.label}</span>
          {item.value ? <span className="tabular-nums">{item.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-32 items-center justify-center px-4 text-center text-sm text-muted">
      {children}
    </div>
  );
}

/** Recharts axis styling, recessive so the marks stay dominant. */
export const AXIS = {
  tick: { fontSize: 11, fill: "var(--muted)" },
  tickLine: false,
} as const;

/**
 * Which side the value axis sits on.
 *
 * A chart is drawn as SVG with computed coordinates, so CSS direction does not
 * touch it: an Arabic page would otherwise keep its scale on the left, where
 * the eye arrives last. The category axis is deliberately left alone. Time runs
 * oldest to newest, hours run midnight to midnight, and reversing an ordered
 * axis states something different about the data rather than translating it.
 */
export function valueAxisSide(dir: Direction): "left" | "right" {
  return dir === "rtl" ? "right" : "left";
}

/**
 * Room for the plot area, mirrored with the axis.
 *
 * The gutter exists so the last mark on the category axis is not pressed
 * against the value axis. Moving that axis to the other side has to move the
 * gutter too, or Arabic loses the breathing room English has.
 */
export function chartMargin(dir: Direction) {
  return dir === "rtl"
    ? { top: 8, right: 0, left: 8, bottom: 0 }
    : { top: 8, right: 8, left: 0, bottom: 0 };
}

/**
 * One decimal policy for a whole axis, chosen from its largest value.
 *
 * Deciding per tick instead puts "5.00" directly above "15.0" on the same axis,
 * which reads as two different measurements rather than one scale.
 */
export function gbTickFormatter(maxGb: number): (value: number) => string {
  const digits = maxGb >= 10 ? 0 : maxGb >= 1 ? 1 : 2;
  return (value: number) => value.toFixed(digits);
}

export function TooltipShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-medium">{title}</div>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );
}

export function TooltipRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {color ? (
        <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
      ) : null}
      <span className="text-muted">{label}</span>
      <span className="ml-auto tabular-nums">{value}</span>
    </div>
  );
}
