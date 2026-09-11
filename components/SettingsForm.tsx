"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Toast, type ToastState } from "@/components/Toast";
import { Interpolate } from "@/lib/i18n/react";
import { fill, type Dictionary } from "@/lib/i18n";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/config";
import type { PublicSettings } from "@/lib/settings";

interface FormState {
  quota_gb: string;
  monthly_quota_gb: string;
  billing_cycle_day: string;
  window_start: string;
  window_end: string;
  timezone: string;
  alert_email_to: string;
  wan_interface_name: string;
  polling_enabled: boolean;
  language: string;
}

function toForm(s: PublicSettings): FormState {
  return {
    quota_gb: String(s.quota_gb),
    monthly_quota_gb: String(s.monthly_quota_gb),
    billing_cycle_day: String(s.billing_cycle_day),
    window_start: s.window_start,
    window_end: s.window_end,
    timezone: s.timezone,
    alert_email_to: s.alert_email_to ?? "",
    wan_interface_name: s.wan_interface_name,
    polling_enabled: s.polling_enabled,
    language: s.language,
  };
}

/**
 * Turn a failed response into one sentence.
 *
 * The route already answers in the language asked for, so the message is used
 * as it stands; only the column name it blames needs a human label, which the
 * dictionary supplies.
 */
async function readError(res: Response, d: Dictionary): Promise<string> {
  const httpError = fill(d.settings.httpError, { status: res.status });
  try {
    const body = await res.json();
    if (body?.details && typeof body.details === "object") {
      const first = Object.entries(body.details as Record<string, string[]>)[0];
      if (first) {
        const labels = d.settings.fields as Record<string, string | undefined>;
        return `${labels[first[0]] ?? first[0]}: ${first[1].join(", ")}`;
      }
    }
    return body?.message ?? httpError;
  } catch {
    return httpError;
  }
}

const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-series-1 focus:ring-2 focus:ring-series-1/30";
const labelClass = "block text-sm font-medium";
const hintClass = "mt-1 text-xs text-muted";

export function SettingsForm() {
  const { locale, d } = useI18n();
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settings?lang=${locale}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, d));
        return (await res.json()) as PublicSettings;
      })
      .then((s) => {
        if (cancelled) return;
        setForm(toForm(s));
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [locale, d]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        quota_gb: Number(form.quota_gb),
        monthly_quota_gb: Number(form.monthly_quota_gb),
        billing_cycle_day: Number(form.billing_cycle_day),
        window_start: form.window_start,
        window_end: form.window_end,
        timezone: form.timezone,
        alert_email_to: form.alert_email_to.trim() || null,
        wan_interface_name: form.wan_interface_name,
        polling_enabled: form.polling_enabled,
        language: form.language,
      };
      const res = await fetch(`/api/settings?lang=${locale}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res, d));
      const saved = (await res.json()) as PublicSettings;
      setForm(toForm(saved));
      setToast({ kind: "success", message: d.settings.saved });
    } catch (err) {
      setToast({
        kind: "error",
        message: fill(d.settings.saveFailed, {
          reason: err instanceof Error ? err.message : String(err),
        }),
      });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const res = await fetch(`/api/test-email?lang=${locale}`, { method: "POST" });
      if (!res.ok) throw new Error(await readError(res, d));
      const body = (await res.json()) as { to: string };
      setToast({ kind: "success", message: fill(d.settings.testSent, { address: body.to }) });
    } catch (err) {
      setToast({
        kind: "error",
        message: fill(d.settings.testFailed, {
          reason: err instanceof Error ? err.message : String(err),
        }),
      });
    } finally {
      setTesting(false);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-status-critical/40 bg-status-critical/5 p-5 text-sm">
        <p className="font-medium text-status-critical">{d.settings.loadFailed}</p>
        <p className="mt-1 text-muted">{loadError}</p>
      </div>
    );
  }
  if (!form) {
    return <p className="text-sm text-muted">{d.settings.loading}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <Section title={d.settings.quotaSection} description={d.settings.quotaSectionHint}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="quota_gb" className={labelClass}>
              {d.settings.quotaGb}
            </label>
            <input
              id="quota_gb"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={form.quota_gb}
              onChange={(e) => update("quota_gb", e.target.value)}
              className={inputClass}
            />
            <p className={hintClass}>{d.settings.quotaGbHint}</p>
          </div>
          <div>
            <label htmlFor="window_start" className={labelClass}>
              {d.settings.windowStart}
            </label>
            <input
              id="window_start"
              type="time"
              required
              value={form.window_start}
              onChange={(e) => update("window_start", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="window_end" className={labelClass}>
              {d.settings.windowEnd}
            </label>
            <input
              id="window_end"
              type="time"
              required
              value={form.window_end}
              onChange={(e) => update("window_end", e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <div className="mt-4 sm:max-w-sm">
          <label htmlFor="timezone" className={labelClass}>
            {d.settings.timezone}
          </label>
          {/* An IANA name is an identifier, not prose: it stays ltr so
              "Asia/Beirut" does not come apart around the slash in Arabic. */}
          <input
            id="timezone"
            type="text"
            required
            dir="ltr"
            list="tz-list"
            value={form.timezone}
            onChange={(e) => update("timezone", e.target.value)}
            className={inputClass}
            placeholder={d.settings.timezonePlaceholder}
          />
          <datalist id="tz-list">
            {typeof Intl.supportedValuesOf === "function" &&
              Intl.supportedValuesOf("timeZone").map((tz) => <option key={tz} value={tz} />)}
          </datalist>
          <p className={hintClass}>{d.settings.timezoneHint}</p>
        </div>
      </Section>

      <Section title={d.settings.monthlySection} description={d.settings.monthlySectionHint}>
        <div className="grid gap-4 sm:grid-cols-2 sm:max-w-lg">
          <div>
            <label htmlFor="monthly_quota_gb" className={labelClass}>
              {d.settings.monthlyQuotaGb}
            </label>
            <input
              id="monthly_quota_gb"
              type="number"
              min="0.01"
              step="1"
              required
              value={form.monthly_quota_gb}
              onChange={(e) => update("monthly_quota_gb", e.target.value)}
              className={inputClass}
            />
            <p className={hintClass}>{d.settings.monthlyQuotaGbHint}</p>
          </div>
          <div>
            <label htmlFor="billing_cycle_day" className={labelClass}>
              {d.settings.billingCycleDay}
            </label>
            <input
              id="billing_cycle_day"
              type="number"
              min="1"
              max="31"
              step="1"
              required
              value={form.billing_cycle_day}
              onChange={(e) => update("billing_cycle_day", e.target.value)}
              className={inputClass}
            />
            <p className={hintClass}>{d.settings.billingCycleDayHint}</p>
          </div>
        </div>
      </Section>

      <Section title={d.settings.alertsSection}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 sm:max-w-sm">
            <label htmlFor="alert_email_to" className={labelClass}>
              {d.settings.alertEmail}
            </label>
            <input
              id="alert_email_to"
              type="email"
              dir="ltr"
              value={form.alert_email_to}
              onChange={(e) => update("alert_email_to", e.target.value)}
              className={inputClass}
              placeholder="bilal.nasr2711@gmail.com"
            />
          </div>
          <button
            type="button"
            onClick={sendTest}
            disabled={testing || !form.alert_email_to}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-border/60 disabled:opacity-50"
          >
            {testing ? d.settings.sending : d.settings.sendTest}
          </button>
        </div>
        <p className={hintClass}>{d.settings.alertEmailHint}</p>

        <div className="mt-4 sm:max-w-sm">
          <label htmlFor="language" className={labelClass}>
            {d.settings.alertLanguage}
          </label>
          <select
            id="language"
            value={form.language}
            onChange={(e) => update("language", e.target.value)}
            className={inputClass}
          >
            {LOCALES.map((option) => (
              <option key={option} value={option}>
                {LOCALE_NAMES[option]}
              </option>
            ))}
          </select>
          <p className={hintClass}>{d.settings.alertLanguageHint}</p>
        </div>
      </Section>

      <Section title={d.settings.routerSection} description={d.settings.routerSectionHint}>
        <div className="sm:max-w-sm">
          <label htmlFor="wan_interface_name" className={labelClass}>
            {d.settings.wanInterfaceName}
          </label>
          <input
            id="wan_interface_name"
            type="text"
            required
            dir="ltr"
            value={form.wan_interface_name}
            onChange={(e) => update("wan_interface_name", e.target.value)}
            className={`${inputClass} font-mono`}
            placeholder="pppoe-out1"
          />
          <p className={hintClass}>
            <Interpolate
              template={d.settings.wanInterfaceNameHint}
              values={{ field: <code>iface</code> }}
            />
          </p>
        </div>
      </Section>

      <Section title={d.settings.monitoringSection}>
        <label className="flex cursor-pointer items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.polling_enabled}
            onClick={() => update("polling_enabled", !form.polling_enabled)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              form.polling_enabled ? "bg-series-1" : "bg-border"
            }`}
          >
            {/* The knob travels towards the end of the line, so in Arabic it
                slides left. Mirroring the movement is the point of the control:
                "on" is always the far side from where the eye starts. */}
            <span
              className={`absolute top-0.5 start-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                form.polling_enabled ? "translate-x-5 rtl:-translate-x-5" : ""
              }`}
            />
          </button>
          <span className="text-sm">
            {form.polling_enabled ? d.settings.pollingEnabled : d.settings.pollingPaused}
            <span className="block text-xs text-muted">{d.settings.pollingHint}</span>
          </span>
        </label>
      </Section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {saving ? d.settings.saving : d.settings.save}
        </button>
      </div>

      <Toast toast={toast} onDismiss={dismiss} />
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 mb-4 text-sm text-muted">{description}</p>}
      {!description && <div className="mb-4" />}
      {children}
    </section>
  );
}
