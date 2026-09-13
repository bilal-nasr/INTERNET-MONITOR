"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
}

interface Panels {
  /** What the panels were rendered for; a different key discards them all. */
  key: string;
  byId: Record<string, ReactNode>;
}

/**
 * A horizontal tab strip over a set of panels, for splitting one long page
 * into views that share the controls above them, where each view's data is
 * read only when its tab is first opened.
 *
 * The server renders one panel, `content`, for the tab named in the query
 * string under `param`. Opening another tab puts that tab in the address and
 * asks the server for the page again, which then reads only the new view's
 * data; until it arrives the panel shows `fallback`. A panel that has arrived
 * is kept, keyed by `cacheKey` (the range the page shows), so going back to a
 * tab is instant and costs no request; a new range starts the collection over.
 *
 * A kept panel stays mounted and is only hidden. Charts measure their
 * container when they mount, and one mounted inside a hidden panel would
 * measure zero and draw nothing.
 */
export function Tabs({
  tabs,
  current,
  content,
  cacheKey,
  fallback,
  param,
  label,
}: {
  tabs: TabItem[];
  /** The tab the server rendered `content` for. */
  current: string;
  content: ReactNode;
  cacheKey: string;
  fallback: ReactNode;
  param: string;
  label: string;
}) {
  const baseId = useId();
  const router = useRouter();
  const [navigating, startTransition] = useTransition();
  const [active, setActive] = useState(current);
  const [panels, setPanels] = useState<Panels>(() => ({ key: cacheKey, byId: { [current]: content } }));
  const [rendered, setRendered] = useState({ cacheKey, current, content });

  // Keep each panel the server sends. Done while rendering, from the props,
  // so a new panel is never drawn one frame late over the fallback.
  if (rendered.cacheKey !== cacheKey || rendered.current !== current || rendered.content !== content) {
    const sameRange = rendered.cacheKey === cacheKey;
    setRendered({ cacheKey, current, content });
    setPanels((kept) =>
      sameRange && kept.key === cacheKey
        ? { key: cacheKey, byId: { ...kept.byId, [current]: content } }
        : { key: cacheKey, byId: { [current]: content } },
    );
    // A new range, or back and forward, decides the tab. A panel arriving for
    // a tab the reader has already moved on from does not.
    if (!sameRange) setActive(current);
  }

  // The address follows the open tab. A request for a tab the reader then left
  // for a kept one finishes by writing its own tab into the address; put the
  // open one back so a reload opens what is on screen.
  //
  // Never while a request is on its way: Next's router takes a replaceState as
  // a navigation of its own, and it would drop the pending one, leaving the new
  // tab on its fallback for good.
  useEffect(() => {
    if (navigating) return;
    const url = new URL(window.location.href);
    // No parameter means the server's default, which is what `current` is then.
    if ((url.searchParams.get(param) ?? current) === active) return;
    url.searchParams.set(param, active);
    window.history.replaceState(null, "", url);
  }, [active, current, param, navigating]);

  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = (id: string) => `${baseId}-panel-${id}`;

  function select(id: string) {
    if (id === active) return;
    setActive(id);
    const url = new URL(window.location.href);
    url.searchParams.set(param, id);
    if (id in panels.byId) {
      // Already here: showing it needs no request. replaceState is picked up by
      // Next's router, so a later router.push that copies the search params
      // carries the tab along.
      window.history.replaceState(null, "", url);
      return;
    }
    startTransition(() => {
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    });
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

      {tabs.map((t) => {
        const kept = t.id in panels.byId;
        if (!kept && t.id !== active) return null;
        return (
          <div
            key={t.id}
            role="tabpanel"
            id={panelId(t.id)}
            aria-labelledby={tabId(t.id)}
            aria-busy={!kept}
            hidden={t.id !== active}
            className="space-y-6"
          >
            {kept ? panels.byId[t.id] : fallback}
          </div>
        );
      })}
    </div>
  );
}
