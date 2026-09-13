"use client";

import { useRef, useState } from "react";

/** One page of a newest-first list and the cursor that continues it. */
export interface KeysetPage<T> {
  rows: T[];
  /** Id of the last row, to fetch the rows after it; null on the last page. */
  next: number | null;
}

/**
 * Newest-first paging by cursor ("the rows after id N") rather than by offset.
 *
 * These lists grow at the top while they are being read: the page refreshes
 * itself, and each refresh can bring a new row. With an offset, every new row
 * pushes one row from page one onto page two, so paging on shows it twice and
 * the rows at the far end of a page drift. A cursor names a row, so "after N"
 * is the same set of rows whatever arrived since, and the database reads it
 * straight off an index instead of counting past every earlier row.
 *
 * The first page is the server's, passed in fresh on every refresh. Later pages
 * are fetched on demand and kept by cursor: everything past the first page is
 * history that no longer changes, so going back to one is instant. Keying the
 * cache by cursor rather than by page number also keeps it right when the first
 * page moves: its new last row is a new cursor, and a new cursor is a new fetch.
 */
export function useKeysetPages<T>({
  first,
  pageSize,
  load,
  onPageChange,
}: {
  first: KeysetPage<T>;
  pageSize: number;
  load: (cursor: number, signal: AbortSignal) => Promise<KeysetPage<T>>;
  /** Called after a page is shown, to scroll the list back into view. */
  onPageChange?: () => void;
}) {
  // The cursor each page beyond the first was fetched with; empty on page one.
  const [trail, setTrail] = useState<number[]>([]);
  const [cache, setCache] = useState<ReadonlyMap<number, KeysetPage<T>>>(() => new Map());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const cursor = trail.at(-1);
  const page = (cursor === undefined ? first : cache.get(cursor)) ?? first;
  const start = page.rows.length === 0 ? 0 : trail.length * pageSize + 1;

  function show(nextTrail: number[]) {
    inflight.current?.abort();
    inflight.current = null;
    setPending(false);
    setError(null);
    setTrail(nextTrail);
    onPageChange?.();
  }

  function older() {
    const nextCursor = page.next;
    if (nextCursor === null) return;
    if (cache.has(nextCursor)) {
      show([...trail, nextCursor]);
      return;
    }

    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setPending(true);
    setError(null);
    load(nextCursor, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setCache((current) => new Map(current).set(nextCursor, loaded));
        show([...trail, nextCursor]);
      })
      .catch((err: Error) => {
        if (controller.signal.aborted || err.name === "AbortError") return;
        inflight.current = null;
        setPending(false);
        setError(err.message);
      });
  }

  return {
    rows: page.rows,
    start,
    end: start === 0 ? 0 : start + page.rows.length - 1,
    hasNewer: trail.length > 0,
    hasOlder: page.next !== null,
    pending,
    error,
    older,
    newer: () => show(trail.slice(0, -1)),
    newest: () => show([]),
  };
}
