"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/**
 * Re-runs the server components of the current page on an interval, so the page
 * follows the database without a manual reload. Refreshing pauses while the tab
 * is hidden and catches up as soon as it is visible again.
 */
export function AutoRefresh({ seconds = 15, label = "Live" }: { seconds?: number; label?: string }) {
  const router = useRouter();
  const [age, setAge] = useState(0);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setAge(0);
    setBusy(true);
    router.refresh();
    // The RSC payload usually lands well inside this window; the flash is only
    // there to show the click did something.
    setTimeout(() => setBusy(false), 600);
  }, [router]);

  useEffect(() => {
    const tick = setInterval(() => setAge((a) => a + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, seconds * 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, seconds]);

  return (
    <button
      type="button"
      onClick={refresh}
      title={`Refreshes every ${seconds} seconds. Click to refresh now.`}
      className="inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground"
    >
      <span className="relative flex size-2">
        <span
          className={`absolute inline-flex size-2 rounded-full bg-status-good ${
            busy ? "animate-ping opacity-75" : "opacity-0"
          }`}
        />
        <span className="relative inline-flex size-2 rounded-full bg-status-good" />
      </span>
      {label}
      <span className="tabular-nums">{age === 0 ? "just now" : `${age}s ago`}</span>
    </button>
  );
}
