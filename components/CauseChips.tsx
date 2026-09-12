"use client";

import { useI18n } from "@/components/I18nProvider";
import { fill } from "@/lib/i18n";
import { causeSide, segmentSeconds, type CauseSegment, type CauseSide } from "@/lib/outage-cause";

/** Amber for the owner's side, red for the ISP's, grey for neither, dashed for unknown. */
const TONE: Record<CauseSide, string> = {
  yours: "border-status-warning/40 bg-status-warning/10 text-amber-700 dark:text-status-warning",
  isp: "border-status-critical/40 bg-status-critical/10 text-status-critical",
  neutral: "border-border bg-border/40 text-muted",
  unknown: "border-dashed border-border text-muted",
};

/** An outage's causes in time order: `Router off 40m → No internet from the ISP 5m`. */
export function CauseChips({ causes }: { causes: CauseSegment[] }) {
  const { d, f } = useI18n();
  // Nothing when every segment is "unknown": pre-feature rows and unexplained
  // short drops (a midnight reconnect, a flap under the silence threshold)
  // stay quiet instead of showing a dashed "cause unknown" chip on every one
  // of them. Same reasoning as describeSplit. A mix that has some known cause
  // alongside unknown still shows every chip.
  if (causes.length === 0 || causes.every((segment) => segment.cause === "unknown")) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {causes.map((segment, i) => (
        <span key={`${segment.from}-${segment.cause}`} className="inline-flex items-center gap-1">
          {/* Mirrored on the Arabic page, where time runs right to left. */}
          {i > 0 && (
            <span aria-hidden className="inline-block text-muted rtl:-scale-x-100">
              →
            </span>
          )}
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[causeSide(segment.cause)]}`}>
            {fill(d.sessions.causeSegment, {
              cause: d.sessions.causes[segment.cause],
              duration: f.duration(segmentSeconds(segment)),
            })}
          </span>
        </span>
      ))}
    </span>
  );
}
