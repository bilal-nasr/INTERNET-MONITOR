"use client";

import { useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "@/components/I18nProvider";
import { SettingsCard } from "@/components/settings/SettingsCard";
import {
  APPEARANCES,
  readAppearance,
  setAppearance,
  subscribeAppearance,
  type Appearance,
} from "@/lib/appearance";

const ICON: Record<Appearance, ReactNode> = {
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  dark: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />,
};

/**
 * Light, dark or the device's own setting. It applies the moment it is picked
 * and is kept in this browser only, so it sits outside the settings form and
 * its save bar.
 *
 * The server has no way to know the stored choice, so it renders "system" and
 * the real value is swapped in on hydration; the page itself is already in the
 * right theme by then, set by the script in the root layout.
 */
export function AppearanceCard() {
  const { d } = useI18n();
  const current = useSyncExternalStore(subscribeAppearance, readAppearance, () => "system" as const);
  const a = d.settings.appearance;
  const labels: Record<Appearance, string> = { system: a.system, light: a.light, dark: a.dark };

  /** Arrow keys move the choice, as in any radio group; Home and End jump to either end. */
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const count = APPEARANCES.length;
    const index = APPEARANCES.indexOf(current);
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    let next: number;
    if (e.key === "ArrowDown" || e.key === (rtl ? "ArrowLeft" : "ArrowRight")) next = index + 1;
    else if (e.key === "ArrowUp" || e.key === (rtl ? "ArrowRight" : "ArrowLeft")) next = index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else return;
    e.preventDefault();
    const target = APPEARANCES[(next + count) % count];
    setAppearance(target);
    e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-appearance="${target}"]`)?.focus();
  }

  return (
    <SettingsCard title={a.card} description={a.cardHint}>
      <div role="radiogroup" aria-label={a.card} className="grid gap-3 sm:grid-cols-3">
        {APPEARANCES.map((option) => {
          const selected = current === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              data-appearance={option}
              onClick={() => setAppearance(option)}
              onKeyDown={onKeyDown}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-start text-sm font-medium transition-colors ${
                selected
                  ? "border-series-1 bg-series-1/10 ring-1 ring-series-1"
                  : "border-border hover:bg-border/40"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`size-5 shrink-0 ${selected ? "text-series-1" : "text-muted"}`}
                aria-hidden
              >
                {ICON[option]}
              </svg>
              {labels[option]}
            </button>
          );
        })}
      </div>
    </SettingsCard>
  );
}
