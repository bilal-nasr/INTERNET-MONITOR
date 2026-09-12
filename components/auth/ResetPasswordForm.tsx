"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/I18nProvider";
import { inputClass, labelClass, primaryButtonClass, readApiError } from "@/components/auth/fields";
import { Turnstile } from "@/components/Turnstile";
import { fill } from "@/lib/i18n";

export function ResetPasswordForm({ token, siteKey }: { token: string; siteKey: string | null }) {
  const { locale, d } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  // Bumped after a refused submit: the token was spent, so the widget remounts for another.
  const [attempt, setAttempt] = useState(0);
  const waiting = siteKey !== null && captcha === null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError(d.errors.passwordMismatch);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/reset?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, confirm_password: confirm, turnstile_token: captcha }),
      });
      if (!res.ok) {
        setCaptcha(null);
        setAttempt((a) => a + 1);
        setError(await readApiError(res, fill(d.settings.httpError, { status: res.status })));
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm">
          {d.auth.reset.done}
        </p>
        <Link href={`/${locale}/login`} className={primaryButtonClass}>
          {d.auth.login.submit}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="new-password" className={labelClass}>
          {d.auth.reset.newPassword}
        </label>
        <input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="confirm-password" className={labelClass}>
          {d.auth.reset.confirmPassword}
        </label>
        <input
          id="confirm-password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
        />
      </div>

      {siteKey && (
        <Turnstile key={attempt} siteKey={siteKey} action="reset-password" onToken={setCaptcha} />
      )}

      {error && (
        <p role="alert" className="text-sm text-status-critical">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy || waiting || !password || !confirm} className={primaryButtonClass}>
        {busy ? d.auth.reset.submitting : d.auth.reset.submit}
      </button>
    </form>
  );
}
