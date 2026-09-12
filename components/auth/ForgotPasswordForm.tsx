"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/I18nProvider";
import { inputClass, labelClass, primaryButtonClass, readApiError } from "@/components/auth/fields";
import { Turnstile } from "@/components/Turnstile";
import { fill } from "@/lib/i18n";

export function ForgotPasswordForm({ siteKey }: { siteKey: string | null }) {
  const { locale, d } = useI18n();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  // Bumped after a refused submit: the token was spent, so the widget remounts for another.
  const [attempt, setAttempt] = useState(0);
  const waiting = siteKey !== null && captcha === null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/forgot?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, turnstile_token: captcha }),
      });
      if (!res.ok) {
        setCaptcha(null);
        setAttempt((a) => a + 1);
        setError(await readApiError(res, fill(d.settings.httpError, { status: res.status })));
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm">
          {d.auth.forgot.sent}
        </p>
        <Link href={`/${locale}/login`} className="text-sm underline">
          {d.auth.forgot.backToLogin}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="username" className={labelClass}>
          {d.auth.login.username}
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputClass}
        />
      </div>

      {siteKey && (
        <Turnstile key={attempt} siteKey={siteKey} action="forgot-password" onToken={setCaptcha} />
      )}

      {error && (
        <p role="alert" className="text-sm text-status-critical">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy || waiting || !username} className={primaryButtonClass}>
        {busy ? d.auth.forgot.submitting : d.auth.forgot.submit}
      </button>

      <p className="text-center text-sm">
        <Link href={`/${locale}/login`} className="text-muted underline hover:text-foreground">
          {d.auth.forgot.backToLogin}
        </Link>
      </p>
    </form>
  );
}
