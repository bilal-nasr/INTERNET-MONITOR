"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/I18nProvider";
import { rangeLabel, type RangePreset } from "@/lib/range";

/**
 * The time filter for the statistics and sessions pages.
 *
 * Selecting a range rewrites the URL rather than fetching: the server component
 * re-renders with the new bounds, so every view is bookmarkable and shareable,
 * and the browser never has to know how a range is resolved. The language is
 * already in the path, so it travels with the range for free.
 */

/** The ranges reached for most, one click each. */
const QUICK: RangePreset[] = ["last_24h", "today", "last_7d", "this_cycle", "last_30d"];

/**
 * Everything else, behind one menu. Thirteen buttons wrapped onto two rows
 * and had to be read through every time to find the common ones.
 */
const MORE: RangePreset[] = [
  "last_hour",
  "last_6h",
  "yesterday",
  "this_week",
  "last_cycle",
  "last_90d",
  "this_year",
  "all_time",
];

const pill = (active: boolean) =>
  `rounded-md px-2.5 py-1.5 text-xs transition-colors ${
    active
      ? "bg-foreground text-background"
      : "border border-border text-muted hover:bg-border/60 hover:text-foreground"
  }`;

export function RangePicker({
  preset,
  from,
  to,
}: {
  preset: string;
  from: string | null;
  to: string | null;
}) {
  const { d } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The panel is open whenever a custom range is showing, and can also be
  // opened by hand from any preset.
  const [requestedOpen, setRequestedOpen] = useState(false);
  const open = requestedOpen || preset === "custom";
  const inMore = (MORE as string[]).includes(preset);

  function go(next: Record<string, string | null>) {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    router.push(`${pathname}?${query.toString()}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {QUICK.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === preset}
            onClick={() => go({ range: p, from: null, to: null })}
            className={pill(p === preset)}
          >
            {rangeLabel(d, p)}
          </button>
        ))}
        {/* Shows the chosen range when it is one of these, and reads as a
            highlighted pill like the buttons beside it. */}
        <select
          aria-label={d.rangePicker.more}
          value={inMore ? preset : ""}
          onChange={(e) => {
            if (e.target.value) go({ range: e.target.value, from: null, to: null });
          }}
          className={`${pill(inMore)} cursor-pointer pe-7 outline-none focus-visible:ring-2 focus-visible:ring-series-1/40`}
        >
          <option value="" disabled>
            {d.rangePicker.more}
          </option>
          {MORE.map((p) => (
            <option key={p} value={p}>
              {rangeLabel(d, p)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={preset === "custom"}
          aria-expanded={open}
          onClick={() => setRequestedOpen((v) => !v)}
          className={pill(preset === "custom")}
        >
          {d.rangePicker.custom}
        </button>
      </div>

      {open && (
        // Keyed on the applied range, so a range chosen elsewhere (the back
        // button, a shared link) remounts the fields with those dates instead
        // of an effect racing whatever is half-typed in them.
        <CustomRangeForm
          key={`${from ?? ""}|${to ?? ""}`}
          initialFrom={from}
          initialTo={to}
          onApply={(next) => go({ range: "custom", ...next })}
        />
      )}
    </div>
  );
}

function CustomRangeForm({
  initialFrom,
  initialTo,
  onApply,
}: {
  initialFrom: string | null;
  initialTo: string | null;
  onApply: (range: { from: string; to: string }) => void;
}) {
  const { d } = useI18n();
  const [from, setFrom] = useState(initialFrom ?? "");
  const [to, setTo] = useState(initialTo ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (from && to) onApply({ from, to });
  }

  const field =
    "mt-1 block rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-series-1 focus:ring-2 focus:ring-series-1/30";

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-muted">
        {d.common.from}
        <input
          type="date"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={field}
        />
      </label>
      <label className="text-xs text-muted">
        {d.common.to}
        <input
          type="date"
          required
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={field}
        />
      </label>
      <button
        type="submit"
        className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background transition-opacity hover:opacity-90"
      >
        {d.common.apply}
      </button>
      <span className="text-xs text-muted">{d.rangePicker.bothDaysIncluded}</span>
    </form>
  );
}
