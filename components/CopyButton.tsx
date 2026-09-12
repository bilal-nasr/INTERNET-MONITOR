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
}: {
  text: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
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

  return (
    <button type="button" onClick={copy} className={secondaryButtonClass}>
      {state === "copied" ? copiedLabel : state === "failed" ? failedLabel : label}
    </button>
  );
}
