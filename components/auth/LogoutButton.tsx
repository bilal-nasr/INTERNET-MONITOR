"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";

export function LogoutButton() {
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
      className="rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:bg-border/60 hover:text-foreground disabled:opacity-50"
    >
      {d.auth.logout}
    </button>
  );
}
