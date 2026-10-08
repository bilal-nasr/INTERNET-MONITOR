/**
 * The meter's disc: it moves at the speed of the line.
 *
 * On an electricity meter the disc behind the glass is seen edge-on through a
 * slot, and the faster its rim slides past, the more is being drawn. This one
 * does the same for the link, in the same recessed window as the counters: its
 * period comes from the newest throughput reading, square-rooted so a quiet
 * line still visibly creeps and a saturated one does not become a blur. A
 * stopped or unknown line parks it. Under reduced motion it never moves; the
 * rate printed beside it carries the reading on its own.
 */

const MBIT = 8 / 1e6;

/** Seconds per turn for a rate, or null when the disc should stand still. */
export function discPeriod(bytesPerSecond: number | null): number | null {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond)) return null;
  const mbit = bytesPerSecond * MBIT;
  if (mbit < 0.02) return null;
  return Math.min(16, Math.max(0.7, 8 / Math.sqrt(mbit)));
}

export function MeterDisc({ bytesPerSecond, className = "" }: { bytesPerSecond: number | null; className?: string }) {
  const period = discPeriod(bytesPerSecond);

  return (
    // The rim slides the same way in both languages, like the meter itself.
    <span
      dir="ltr"
      aria-hidden
      className={`block h-4 overflow-hidden rounded-md bg-surface-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.12)] ring-1 ring-border ring-inset ${className}`}
    >
      <span
        className="meter-band block size-full"
        data-spinning={period ? "" : undefined}
        style={period ? ({ "--period": `${period.toFixed(2)}s` } as React.CSSProperties) : undefined}
      />
    </span>
  );
}
