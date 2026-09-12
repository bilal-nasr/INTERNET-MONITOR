"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/components/I18nProvider";
import { inputClass, labelClass, primaryButtonClass, readApiError } from "@/components/auth/fields";
import { Turnstile } from "@/components/Turnstile";
import { fill } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";

/**
 * Where to go after signing in. Only a path on this site is accepted: a full
 * URL or a protocol-relative one would let a crafted link send a fresh session
 * somewhere else.
 */
function safeNext(value: string | null, locale: Locale): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return `/${locale}`;
  }
  return value;
}

export function LoginForm({ siteKey }: { siteKey: string | null }) {
  const { locale, d } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), locale);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
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
      const res = await fetch(`/api/auth/login?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, turnstile_token: captcha }),
      });
      if (!res.ok) {
        setCaptcha(null);
        setAttempt((a) => a + 1);
        setError(await readApiError(res, fill(d.settings.httpError, { status: res.status })));
        return;
      }
      router.replace(next);
      // The layout decides what to show from the cookie; make it look again.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
      <div>
        <label htmlFor="password" className={labelClass}>
          {d.auth.login.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      {siteKey && (
        <Turnstile key={attempt} siteKey={siteKey} action="login" onToken={setCaptcha} />
      )}

      {error && (
        <p role="alert" className="text-sm text-status-critical">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy || waiting || !username || !password} className={primaryButtonClass}>
        {busy ? d.auth.login.submitting : d.auth.login.submit}
      </button>

      <p className="text-center text-sm">
        <Link href={`/${locale}/forgot-password`} className="text-muted underline hover:text-foreground">
          {d.auth.login.forgot}
        </Link>
      </p>
    </form>
  );
}
