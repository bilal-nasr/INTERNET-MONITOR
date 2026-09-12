"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Toast, type ToastState } from "@/components/Toast";
import { readApiError, secondaryButtonClass } from "@/components/auth/fields";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { fill } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";

/** The origin never changes while the page is open, so there is nothing to watch. */
const subscribeToNothing = () => () => {};

/**
 * Create, copy, replace or drop the read-only link.
 *
 * The link is composed in the browser from its own origin so what is shown is
 * what the visitor would type; the server answers with the same URL built from
 * APP_URL, and that one wins when present, since it is the public address.
 */
export function ShareCard({ initialToken, locale }: { initialToken: string | null; locale: Locale }) {
  const { d } = useI18n();
  const s = d.share;
  const [token, setToken] = useState<string | null>(initialToken);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  // The origin is the browser's to know, not the server's. Subscribing to
  // nothing and answering `null` on the server keeps the first client render
  // identical to the markup that came down, so there is no hydration mismatch;
  // the link appears on the pass straight after.
  const origin = useSyncExternalStore(subscribeToNothing, () => window.location.origin, () => null);

  const link = url ?? (token && origin ? `${origin}/${locale}/share/${token}` : null);
  const feedPath = token ? `/api/share/${token}/usage` : "/api/share/<token>/usage";

  async function create() {
    setBusy(true);
    try {
      const res = await fetch(`/api/share?lang=${locale}`, { method: "POST" });
      if (!res.ok) throw new Error(await readApiError(res, fill(d.settings.httpError, { status: res.status })));
      const body = (await res.json()) as { token: string; url: string };
      setToken(body.token);
      setUrl(body.url);
      setToast({ kind: "success", message: s.created });
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const res = await fetch(`/api/share?lang=${locale}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readApiError(res, fill(d.settings.httpError, { status: res.status })));
      setToken(null);
      setUrl(null);
      setToast({ kind: "success", message: s.turnedOff });
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setToast({ kind: "success", message: s.copied });
    } catch {
      setToast({ kind: "error", message: s.copyFailed });
    }
  }

  return (
    <SettingsCard title={s.linkLabel} description={s.sectionHint}>
      {token && link ? (
        <div className="space-y-3">
          {/* The card is already titled with these words; the label stays for a screen reader. */}
          <label htmlFor="share-link" className="sr-only">
            {s.linkLabel}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* A URL is an identifier: left to right whatever the page's direction. */}
            <input
              id="share-link"
              readOnly
              dir="ltr"
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none"
            />
            <button type="button" onClick={copy} className={secondaryButtonClass}>
              {s.copy}
            </button>
          </div>
          <p className="text-xs text-muted">{fill(s.feedHint, { path: feedPath })}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={create} disabled={busy} className={secondaryButtonClass}>
              {busy ? s.working : s.replace}
            </button>
            <button
              type="button"
              onClick={turnOff}
              disabled={busy}
              className="text-sm text-status-critical hover:underline disabled:opacity-50"
            >
              {s.turnOff}
            </button>
            <span className="text-xs text-muted">{s.replaceHint}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">{s.off}</span>
          <button type="button" onClick={create} disabled={busy} className={secondaryButtonClass}>
            {busy ? s.working : s.create}
          </button>
        </div>
      )}

      <Toast toast={toast} onDismiss={dismiss} />
    </SettingsCard>
  );
}
