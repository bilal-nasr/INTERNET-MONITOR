/**
 * A state stamped onto the reading it qualifies: over quota, link down, no
 * contact, a gap in the record. Nothing on these pages disappears when
 * something goes wrong; it gets a stamp where it stands, in the colour of the
 * state and with the state's own words, so colour is never the only signal.
 */

export type StampTone = "good" | "warning" | "critical" | "neutral" | "free";

const TONE: Record<StampTone, string> = {
  good: "border-green-700/60 text-green-800 dark:border-status-good/60 dark:text-status-good",
  warning: "border-amber-700/60 text-amber-800 dark:border-status-warning/60 dark:text-status-warning",
  critical: "border-status-critical/70 bg-status-critical/8 text-status-critical",
  neutral: "border-border text-muted",
  free: "border-green-700/40 bg-green-700/8 text-green-800 dark:border-status-good/40 dark:text-status-good",
};

export function Stamp({
  tone,
  children,
  className = "",
}: {
  tone: StampTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-sm border-[1.5px] px-1.5 py-px text-[0.6875rem] font-semibold uppercase leading-4 tracking-[0.06em] ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
