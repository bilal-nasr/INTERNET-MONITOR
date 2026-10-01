"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Toast, type ToastState } from "@/components/Toast";
import { hintClass, inputClass, labelClass, readApiError, secondaryButtonClass } from "@/components/auth/fields";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { RESET_STEPS, type ResetCounts } from "@/lib/data-reset-steps";
import { fill } from "@/lib/i18n";

interface Cycle {
  start: string;
  end: string;
}

const dangerButtonClass =
  "inline-flex items-center justify-center rounded-md bg-status-critical px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";

/**
 * Delete everything recorded before the end of a finished cycle, confirmed by
 * a code sent to the owner's email (app/api/data-reset).
 *
 * It sits inside the settings form, so it holds only type="button" controls
 * and the code field handles Enter itself: a submit here would save settings.
 */
export function DataResetCard({ timezone }: { timezone: string }) {
  const { d, f, locale } = useI18n();
  const t = d.dataReset;
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [counts, setCounts] = useState<ResetCounts | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  const httpError = useCallback(
    (res: Response) => readApiError(res, fill(d.settings.httpError, { status: res.status })),
    [d],
  );

  const loadCycles = useCallback(async () => {
    try {
      const res = await fetch(`/api/data-reset?lang=${locale}`);
      if (!res.ok) throw new Error(await httpError(res));
      const body = (await res.json()) as { cycles: Cycle[] };
      setCycles(body.cycles);
      setBefore(body.cycles[0]?.end ?? null);
    } catch (err) {
      setCycles([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [locale, httpError]);

  useEffect(() => {
    // Fetching on mount is what this effect is for; the state it sets is the answer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCycles();
  }, [loadCycles]);

  useEffect(() => {
    if (!before) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCounts(null);
    fetch(`/api/data-reset?lang=${locale}&before=${encodeURIComponent(before)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await httpError(res));
        const body = (await res.json()) as { counts: ResetCounts };
        if (live) setCounts(body.counts);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, [before, locale, httpError]);

  function reset() {
    setSentTo(null);
    setCode("");
    setError(null);
  }

  async function sendCode() {
    if (!before) return;
    setBusy("send");
    setError(null);
    try {
      const res = await fetch(`/api/data-reset/code?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ before }),
      });
      if (!res.ok) throw new Error(await httpError(res));
      const body = (await res.json()) as { sent_to: string };
      setSentTo(body.sent_to);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!before || busy) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/data-reset?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ before, code }),
      });
      if (!res.ok) throw new Error(await httpError(res));
      const body = (await res.json()) as { total: number };
      setToast({
        kind: "success",
        message: fill(t.deleted, { count: f.count(body.total), date: f.dayMonth(before, timezone) }),
      });
      reset();
      setCycles(null);
      setCounts(null);
      await loadCycles();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function onCodeKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void confirm();
  }

  const date = before ? f.dayMonth(before, timezone) : "";
  const visible = counts ? RESET_STEPS.filter((s) => counts[s] > 0) : [];
  const hasData = visible.length > 0;

  return (
    <SettingsCard title={t.card} description={t.hint}>
      {cycles === null ? (
        <p className="text-sm text-muted">{t.loading}</p>
      ) : cycles.length === 0 ? (
        <p className="text-sm text-muted">{t.none}</p>
      ) : (
        <div className="space-y-4">
          <div className="sm:max-w-xs">
            <label htmlFor="data-reset-cutoff" className={labelClass}>
              {t.cutoffLabel}
            </label>
            <select
              id="data-reset-cutoff"
              value={before ?? ""}
              onChange={(e) => {
                setBefore(e.target.value);
                reset();
              }}
              disabled={busy !== null || sentTo !== null}
              className={inputClass}
            >
              {cycles.map((c) => (
                <option key={c.end} value={c.end}>
                  {fill(d.cycle.span, { start: f.dayMonth(c.start, timezone), end: f.dayMonth(c.end, timezone) })}
                </option>
              ))}
            </select>
          </div>

          {counts === null ? (
            <p className="text-sm text-muted">{t.loading}</p>
          ) : !hasData ? (
            <p className="text-sm text-muted">{fill(t.nothing, { date })}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">{fill(t.willRemove, { date })}</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm sm:max-w-md">
                {visible.map((step) => (
                  <div key={step} className="contents">
                    <dt className="text-muted">{t.counts[step]}</dt>
                    <dd className="text-end tabular-nums">{f.count(counts[step])}</dd>
                  </div>
                ))}
              </dl>
              <Link href={`/${locale}/export`} className="inline-block text-xs text-series-1 hover:underline">
                {t.exportHint}
              </Link>
            </div>
          )}

          {hasData &&
            (sentTo === null ? (
              <button type="button" onClick={sendCode} disabled={busy !== null} className={secondaryButtonClass}>
                {busy === "send" ? t.sending : t.sendCode}
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">{fill(t.codeSent, { email: sentTo })}</p>
                <div className="sm:max-w-xs">
                  <label htmlFor="data-reset-code" className={labelClass}>
                    {t.codeLabel}
                  </label>
                  {/* Digits: left to right whatever the page's direction. */}
                  <input
                    id="data-reset-code"
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={onCodeKey}
                    className={`${inputClass} font-mono tracking-[0.3em]`}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={busy !== null || code.length !== 6}
                    className={dangerButtonClass}
                  >
                    {busy === "delete" ? t.deleting : t.confirm}
                  </button>
                  <button type="button" onClick={sendCode} disabled={busy !== null} className={secondaryButtonClass}>
                    {busy === "send" ? t.sending : t.resend}
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    disabled={busy !== null}
                    className="text-sm text-muted hover:underline disabled:opacity-50"
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      {error && (
        <p role="alert" className={`${hintClass} text-status-critical`}>
          {error}
        </p>
      )}

      <Toast toast={toast} onDismiss={dismiss} />
    </SettingsCard>
  );
}
