"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";

export function LogoutButton({ onCabinet = false }: { onCabinet?: boolean }) {
  const { locale, d } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Whether or not the server answered, the cookies are gone or dead; the
      // login page is the right place either way.
      router.replace(`/${locale}/login`);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className={`rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
        onCabinet
          ? "border-cabinet-muted/40 text-cabinet-muted hover:bg-cabinet-hover hover:text-cabinet-ink"
          : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      {d.auth.logout}
    </button>
  );
}
