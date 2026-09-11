"use client";

import { useEffect } from "react";
import { useI18n } from "@/components/I18nProvider";

export interface ToastState {
  kind: "success" | "error";
  message: string;
}

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  const { d } = useI18n();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, toast.kind === "success" ? 4000 : 8000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
        toast.kind === "success"
          ? "border-status-good/40 bg-surface text-green-700 dark:text-status-good"
          : "border-status-critical/40 bg-surface text-status-critical"
      }`}
    >
      {toast.message}
      <button
        type="button"
        onClick={onDismiss}
        className="ms-3 text-xs text-muted hover:text-foreground"
        aria-label={d.common.dismiss}
      >
        &#10005;
      </button>
    </div>
  );
}
