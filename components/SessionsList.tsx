"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Toast, type ToastState } from "@/components/Toast";
import { readApiError, secondaryButtonClass } from "@/components/auth/fields";
import { SettingsCard } from "@/components/settings/SettingsCard";
import type { PublicSession } from "@/lib/auth/sessions";
import type { UserAgentDescription } from "@/lib/auth/user-agent";
import { fill, type Dictionary } from "@/lib/i18n";

function deviceLabel(device: UserAgentDescription, d: Dictionary): string {
  const b = d.auth.browsers;
  const browser = b[device.browser];
  const os = device.os === "unknown" ? b.unknownOs : b[device.os];
  return fill(b.on, { browser, os });
}

/**
 * The browsers signed in to this account, with a way to sign each one out.
 *
 * The rows are fetched when the list first mounts, which the settings page
 * puts off until its account tab is opened. After any change the list is
 * fetched again rather than patched, so what is shown is always what the
 * database says.
 */
export function SessionsList({ timezone }: { timezone: string }) {
  const { locale, d, f } = useI18n();
  const s = d.auth.sessions;
  const [rows, setRows] = useState<PublicSession[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/auth/sessions?lang=${locale}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readApiError(res, fill(d.settings.httpError, { status: res.status })));
        return (await res.json()) as { sessions: PublicSession[] };
      })
      .then((body) => setRows(body.sessions))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setLoadError(err.message);
      });
    return () => controller.abort();
  }, [locale, d]);

  /**
   * Refresh the table from the database. The signing-out itself has already
   * happened by the time this runs, so a failure here is a stale table and not
   * a failed sign-out: it is reported quietly rather than as an error over the
   * success, and the row it could not remove is taken out locally so the table
   * still says what the database says.
   */
  async function reload(revoked: number | "others") {
    try {
      const res = await fetch(`/api/auth/sessions?lang=${locale}`);
      if (!res.ok) throw new Error(await readApiError(res, fill(d.settings.httpError, { status: res.status })));
      const body = (await res.json()) as { sessions: PublicSession[] };
      setRows(body.sessions);
    } catch {
      setRows((current) =>
        current === null
          ? current
          : revoked === "others"
            ? current.filter((r) => r.current)
            : current.filter((r) => r.id !== revoked),
      );
    }
  }

  async function revoke(id: number) {
    setBusy(id);
    try {
      const res = await fetch(`/api/auth/sessions/${id}?lang=${locale}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readApiError(res, fill(d.settings.httpError, { status: res.status })));
      setToast({ kind: "success", message: s.signedOutOne });
      await reload(id);
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers() {
    setBusy("all");
    try {
      const res = await fetch(`/api/auth/sessions?lang=${locale}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readApiError(res, fill(d.settings.httpError, { status: res.status })));
      setToast({ kind: "success", message: s.signedOutOthers });
      await reload("others");
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  if (rows === null) {
    return (
      <SettingsCard title={s.section} description={s.sectionHint}>
        {loadError ? (
          <p className="text-sm text-status-critical">{loadError}</p>
        ) : (
          <div className="animate-pulse space-y-2" aria-busy="true">
            <span className="sr-only">{d.common.loading}</span>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-8 rounded-md bg-border/40" />
            ))}
          </div>
        )}
      </SettingsCard>
    );
  }

  const others = rows.filter((r) => !r.current);

  return (
    <SettingsCard title={s.section} description={s.sectionHint}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="text-start">
              <th className="py-2 pe-3 text-start font-medium">{s.device}</th>
              <th className="py-2 pe-3 text-start font-medium">{s.address}</th>
              <th className="py-2 pe-3 text-start font-medium">{s.lastUsed}</th>
              <th className="py-2 pe-3 text-start font-medium">{s.signedIn}</th>
              <th className="py-2 text-start font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-2 pe-3">
                  {deviceLabel(row.device, d)}
                  {row.current && (
                    <span className="ms-2 rounded-full bg-series-1/10 px-2 py-0.5 text-xs text-series-1">
                      {s.thisBrowser}
                    </span>
                  )}
                </td>
                {/* An address is an identifier; it reads left to right in both languages. */}
                <td className="py-2 pe-3 font-mono text-xs" dir="ltr">
                  {row.ip ?? <span className="font-sans text-muted">{s.unknownAddress}</span>}
                </td>
                <td className="py-2 pe-3 tabular-nums text-muted">{f.stamp(row.last_used_at, timezone)}</td>
                <td className="py-2 pe-3 tabular-nums text-muted">{f.stamp(row.created_at, timezone)}</td>
                <td className="py-2 text-end">
                  {!row.current && (
                    <button
                      type="button"
                      onClick={() => revoke(row.id)}
                      disabled={busy !== null}
                      className="text-xs text-status-critical hover:underline disabled:opacity-50"
                    >
                      {busy === row.id ? s.working : s.signOut}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {others.length === 0 ? (
        <p className="text-xs text-muted">{s.onlyThis}</p>
      ) : (
        <button type="button" onClick={revokeOthers} disabled={busy !== null} className={secondaryButtonClass}>
          {busy === "all" ? s.working : s.signOutOthers}
        </button>
      )}

      <Toast toast={toast} onDismiss={dismiss} />
    </SettingsCard>
  );
}
