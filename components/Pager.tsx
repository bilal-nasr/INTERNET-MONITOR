"use client";

import { useI18n } from "@/components/I18nProvider";
import { fill } from "@/lib/i18n";

const buttonClass =
  "rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-border/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

/**
 * The controls under a paged table: where the reader is, and the way to the
 * next and previous page.
 *
 * `order` picks the words. A list newest first reads "Newer" and "Older", which
 * says which way time runs; anything else reads "Previous" and "Next".
 *
 * Shown even when everything fits on one page, with both buttons disabled, so
 * the table always says how many rows there are and where paging lives.
 */
export function Pager({
  start,
  end,
  total,
  hasPrevious,
  hasNext,
  onFirst,
  onPrevious,
  onNext,
  pending = false,
  error = null,
  order = "plain",
}: {
  /** 1-based position of the first row shown. */
  start: number;
  /** 1-based position of the last row shown. */
  end: number;
  /** Every row there is, when known. */
  total: number | null;
  hasPrevious: boolean;
  hasNext: boolean;
  onFirst: () => void;
  onPrevious: () => void;
  onNext: () => void;
  pending?: boolean;
  error?: string | null;
  order?: "time" | "plain";
}) {
  const { d, f } = useI18n();
  const p = d.pager;

  const words =
    order === "time"
      ? { first: p.newest, previous: p.newer, next: p.older }
      : { first: p.first, previous: p.previous, next: p.next };
  const position =
    total === null
      ? fill(p.rangeOpen, { from: f.count(start), to: f.count(end) })
      : fill(p.range, { from: f.count(start), to: f.count(end), total: f.count(total) });

  return (
    <nav aria-label={p.label} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs tabular-nums text-muted" aria-live="polite">
          {pending ? d.common.loading : position}
        </span>
        <div className="ms-auto flex items-center gap-1.5">
          {start > 1 && (
            <button type="button" onClick={onFirst} disabled={pending || !hasPrevious} className={buttonClass}>
              {words.first}
            </button>
          )}
          <button type="button" onClick={onPrevious} disabled={pending || !hasPrevious} className={buttonClass}>
            <span aria-hidden className="inline-block rtl:rotate-180">
              &lsaquo;
            </span>{" "}
            {words.previous}
          </button>
          <button type="button" onClick={onNext} disabled={pending || !hasNext} className={buttonClass}>
            {words.next}{" "}
            <span aria-hidden className="inline-block rtl:rotate-180">
              &rsaquo;
            </span>
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-status-critical">{fill(p.failed, { reason: error })}</p>}
    </nav>
  );
}

/**
 * Bring the top of a table back into view after its page changed, when the
 * reader has scrolled past it to reach the controls underneath.
 */
export function revealTop(el: HTMLElement | null) {
  if (!el) return;
  if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: "smooth" });
}
