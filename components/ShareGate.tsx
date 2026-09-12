"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { readApiError } from "@/components/auth/fields";
import { Turnstile } from "@/components/Turnstile";
import { fill } from "@/lib/i18n";

/**
 * What a share-link visitor sees before the usage: the Turnstile widget. Once
 * it passes, the token is traded for a share-pass cookie and the page renders
 * again, this time with the figures. Most browsers pass without a click.
 */
export function ShareGate({ shareToken, siteKey }: { shareToken: string; siteKey: string }) {
  const { locale, d } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  async function redeem(captcha: string | null) {
    if (!captcha) return;
    setError(null);
    try {
      const res = await fetch(`/api/share/${shareToken}/verify?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnstile_token: captcha }),
      });
      if (!res.ok) {
        setError(await readApiError(res, fill(d.settings.httpError, { status: res.status })));
        setAttempt((a) => a + 1);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAttempt((a) => a + 1);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.share.gateTitle}</h1>
        <p className="text-sm text-muted">{d.share.gateHint}</p>
      </div>
      <Turnstile key={attempt} siteKey={siteKey} action="share" onToken={redeem} />
      {error && (
        <p role="alert" className="text-sm text-status-critical">
          {error}
        </p>
      )}
    </div>
  );
}
