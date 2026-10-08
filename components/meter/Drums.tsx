/**
 * A reading in the meter's window, with digits that roll when it changes.
 *
 * Takes the already formatted reading ("4.82 GB") so the figure here is exactly
 * the figure everywhere else. The number sits in one recessed window, the
 * whole part in full ink and the decimals a step quieter, the unit beside it.
 * Each digit is a column of the ten digits behind a window, positioned by a
 * CSS variable, so when the page refreshes with a new value the column slides
 * and the counter rolls. No client code: the roll is a CSS transition on a
 * style that React updates in place.
 *
 * Digits are keyed from the right, so a reading that gains a digit on the left
 * (9.99 -> 10.00) keeps its existing digits in place instead of re-mounting
 * them all.
 */

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

type Size = "lg" | "md" | "sm";

const SIZE: Record<Size, { figure: string; unit: string; window: string }> = {
  lg: { figure: "text-[2rem] font-semibold", unit: "text-sm", window: "px-2.5 py-0.5" },
  md: { figure: "text-xl font-semibold", unit: "text-xs", window: "px-2 py-0.5" },
  sm: { figure: "text-base font-semibold", unit: "text-xs", window: "px-1.5" },
};

export function Drums({
  value,
  size = "lg",
  className = "",
}: {
  /** A formatted reading: a number, optionally followed by a space and a unit. */
  value: string;
  size?: Size;
  className?: string;
}) {
  const space = value.lastIndexOf(" ");
  const figure = space === -1 ? value : value.slice(0, space);
  const unit = space === -1 ? "" : value.slice(space + 1);
  const chars = [...figure];
  const point = chars.indexOf(".");
  const s = SIZE[size];

  return (
    // A reading is read left to right in both languages.
    <span dir="ltr" className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="sr-only">{value}</span>
      <span
        aria-hidden
        className={`inline-flex items-baseline rounded-md bg-surface-2 leading-none tracking-[-0.01em] shadow-[inset_0_1px_2px_rgb(0_0_0/0.12)] ring-1 ring-border ring-inset ${s.window} ${s.figure}`}
      >
        {chars.map((c, i) => {
          const key = chars.length - i;
          const quiet = point !== -1 && i >= point;
          const tone = quiet ? "text-muted" : "";
          if (c >= "0" && c <= "9") {
            return (
              <span key={key} className={`drum-cell ${tone}`}>
                <span className="drum-reel" style={{ "--digit": Number(c) } as React.CSSProperties}>
                  {DIGITS.map((digit) => (
                    <span key={digit}>{digit}</span>
                  ))}
                </span>
              </span>
            );
          }
          return (
            <span key={key} className={tone}>
              {c}
            </span>
          );
        })}
      </span>
      {unit && <span className={`font-medium text-muted ${s.unit}`}>{unit}</span>}
    </span>
  );
}
