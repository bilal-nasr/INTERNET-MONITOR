"use client";

import { useEffect, useState } from "react";
import { secondaryButtonClass } from "@/components/auth/fields";

/**
 * Copies `text` to the clipboard and says so for two seconds. The clipboard
 * API needs a secure context or localhost; on a plain-HTTP LAN address the
 * call rejects and the button falls back to selecting nothing, so the label
 * flips to the error wording the caller supplied.
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  failedLabel,
  compact = false,
}: {
  text: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
  /**
   * A small inline control for a value inside a list of figures, like the
   * router's address on the dashboard; the full-size form button otherwise.
   */
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  const caption = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : label;

  if (!compact) {
    return (
      <button type="button" onClick={copy} className={secondaryButtonClass}>
        {caption}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs font-medium transition-colors ${
        state === "failed"
          ? "border-status-critical/50 text-status-critical"
          : state === "copied"
            ? "border-green-700/50 text-green-800 dark:border-status-good/50 dark:text-status-good"
            : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        className="size-3.5 shrink-0"
        aria-hidden
      >
        {state === "copied" ? (
          <path d="M3 8.5l3 3 7-7" strokeLinecap="round" />
        ) : (
          <>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
            <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
          </>
        )}
      </svg>
      {caption}
    </button>
  );
}
