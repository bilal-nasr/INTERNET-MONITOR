"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/components/I18nProvider";

/**
 * The Cloudflare Turnstile widget. It reports a token through `onToken` once
 * the browser passes, and `null` again when that token expires or the widget
 * fails, so a form can hold its submit until there is something to send.
 *
 * A token is single-use. After a submit the server refused, remount the
 * widget (change its `key`) to fetch another.
 */

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/** Load the script once per page, however many widgets ask for it. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error("turnstile script failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function Turnstile({
  siteKey,
  action,
  onToken,
}: {
  siteKey: string;
  /** Shown in the Cloudflare dashboard's analytics, to tell the pages apart. */
  action: string;
  onToken: (token: string | null) => void;
}) {
  const { locale } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  // Held in a ref so a parent re-render does not tear the widget down.
  const report = useRef(onToken);
  useEffect(() => {
    report.current = onToken;
  });

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;

    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId = api.render(container.current, {
          sitekey: siteKey,
          action,
          language: locale,
          // "auto" follows the device, which is wrong once the appearance
          // setting overrides it; the page's own theme is on <html>.
          theme: document.documentElement.dataset.theme ?? "auto",
          size: "flexible",
          callback: (token: string) => report.current(token),
          "expired-callback": () => report.current(null),
          "error-callback": () => report.current(null),
        });
      })
      .catch((err) => {
        console.error(err);
        report.current(null);
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, action, locale]);

  return <div ref={container} className="min-h-[65px]" />;
}
