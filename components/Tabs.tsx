"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * A horizontal tab strip over a set of panels, for splitting one long page
 * into views that share the controls above them.
 *
 * The open tab is kept in the query string under `param`, next to whatever
 * else is there (a statistics range), so a reload or a shared link opens the
 * same view. It is written with replaceState, which Next's router picks up,
 * so a later router.push that copies the search params carries it along.
 *
 * A panel mounts the first time it is opened and then stays mounted, only
 * hidden. Charts measure their container when they mount, and one mounted
 * inside a hidden panel would measure zero and draw nothing.
 */
export function Tabs({
  tabs,
  initial,
  param,
  label,
}: {
  tabs: TabItem[];
  initial: string;
  param: string;
  label: string;
}) {
  const baseId = useId();
  const [active, setActive] = useState(initial);
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([initial]));

  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = (id: string) => `${baseId}-panel-${id}`;

  function select(id: string) {
    setActive(id);
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)));
    const url = new URL(window.location.href);
    url.searchParams.set(param, id);
    window.history.replaceState(null, "", url);
  }

  /** Left and right follow the reading direction; Home and End jump to either end. */
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const index = tabs.findIndex((t) => t.id === active);
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    let next: number;
    if (e.key === "ArrowRight") next = rtl ? index - 1 : index + 1;
    else if (e.key === "ArrowLeft") next = rtl ? index + 1 : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length].id;
    select(target);
    document.getElementById(tabId(target))?.focus();
  }

  return (
    <div className="space-y-6">
      {/* On a phone the strip scrolls sideways rather than wrapping, so the
          underline under the open tab stays on one line. */}
      <div
        role="tablist"
        aria-label={label}
        className="-mx-4 flex overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        {tabs.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={selected}
              aria-controls={panelId(t.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.id)}
              onKeyDown={onKeyDown}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                selected
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted hover:border-border hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={panelId(t.id)}
          aria-labelledby={tabId(t.id)}
          hidden={t.id !== active}
          className="space-y-6"
        >
          {visited.has(t.id) && t.content}
        </div>
      ))}
    </div>
  );
}
