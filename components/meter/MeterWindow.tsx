/**
 * One window of the meter box: a plate with its engraved label on a band at
 * the top, the reading under it. Every reading on the dashboard sits in one of
 * these, at the same height in a row, so today's window, the cycle and the
 * link read as three equal faces of one instrument.
 */
export function MeterWindow({
  label,
  aside,
  children,
  className = "",
}: {
  label: React.ReactNode;
  /** Context for the label: a time range, the cycle's dates. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col rounded-lg border border-border bg-surface ${className}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border bg-surface-2/60 px-4 py-2">
        <h2 className="plate-label">{label}</h2>
        {aside && <span className="text-xs text-muted">{aside}</span>}
      </header>
      <div className="flex flex-1 flex-col p-4">{children}</div>
    </section>
  );
}

/**
 * The fill against a limit, drawn as a ruled scale rather than a pill: ticks at
 * every tenth, a heavier one at 80% where the warning starts, and an optional
 * marker for where the current rate lands. The same ruler is used for the day
 * and for the cycle, so the two can be compared at a glance.
 */
export function MeterScale({
  percent,
  projected,
  tone,
  label,
}: {
  percent: number;
  /** Where the period lands if the current rate holds, when it is further on. */
  projected?: number | null;
  tone: "good" | "warning" | "critical";
  label: string;
}) {
  const pct = Math.min(100, Math.max(0, percent));
  const proj = projected == null ? null : Math.min(100, Math.max(0, projected));
  const fill =
    tone === "critical" ? "bg-status-critical" : tone === "warning" ? "bg-status-warning" : "bg-cabinet dark:bg-status-good";

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className="relative mt-3"
    >
      <div className="relative h-2.5 overflow-hidden rounded-sm bg-surface-2 ring-1 ring-border ring-inset">
        <div className={`h-full ${fill} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
      </div>
      {/* Ticks sit under the bar, so they never cover the fill. Logical
          offsets, so the scale fills from the start of the line in Arabic. */}
      <div aria-hidden className="relative h-1.5">
        {Array.from({ length: 11 }, (_, i) => (
          <span
            key={i}
            className={`absolute top-0 w-px ${i === 8 || i === 10 || i === 0 ? "h-1.5 bg-muted" : "h-1 bg-border"}`}
            style={{ insetInlineStart: `${i * 10}%` }}
          />
        ))}
        {proj !== null && proj > pct && (
          <span
            className="absolute -top-4 h-5.5 w-0.5 bg-foreground"
            style={{ insetInlineStart: `calc(${proj}% - 1px)` }}
          />
        )}
      </div>
    </div>
  );
}
