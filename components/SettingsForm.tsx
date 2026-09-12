"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useI18n } from "@/components/I18nProvider";
import { Toast, type ToastState } from "@/components/Toast";
import { hintClass, inputClass, labelClass, secondaryButtonClass } from "@/components/auth/fields";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SETTINGS_TABS, isSettingsTab, type SettingsTab } from "@/components/settings/tabs";
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
  devices_enabled: boolean;
  retention_days: string;
  stale_after_minutes: string;
  digest: string;
  alert_thresholds: string;
  cycle_alert_thresholds: string;
  cycle_pace_alert: boolean;
  throttle_on_breach: boolean;
  throttle_on_cap: boolean;
}

/** Which tab each field is on, so a tab can show that it holds unsaved changes. */
const FIELD_TAB: Record<keyof FormState, SettingsTab> = {
  quota_gb: "limits",
  window_start: "limits",
  window_end: "limits",
  timezone: "limits",
  monthly_quota_gb: "limits",
  billing_cycle_day: "limits",
  alert_email_to: "alerts",
  language: "alerts",
  alert_thresholds: "alerts",
  cycle_alert_thresholds: "alerts",
  cycle_pace_alert: "alerts",
  stale_after_minutes: "alerts",
  digest: "alerts",
  polling_enabled: "router",
  wan_interface_name: "router",
  devices_enabled: "router",
  throttle_on_breach: "router",
  throttle_on_cap: "router",
  retention_days: "data",
};

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
    devices_enabled: s.devices_enabled,
    retention_days: String(s.retention_days),
    stale_after_minutes: String(s.stale_after_minutes),
    digest: s.digest,
    alert_thresholds: s.alert_thresholds.join(", "),
    cycle_alert_thresholds: s.cycle_alert_thresholds.join(", "),
    cycle_pace_alert: s.cycle_pace_alert,
    throttle_on_breach: s.throttle_on_breach,
    throttle_on_cap: s.throttle_on_cap,
  };
}

/**
 * Turn a failed response into one sentence, and the field it blames if any.
 *
 * The route already answers in the language asked for, so the message is used
 * as it stands; only the column name it blames needs a human label, which the
 * dictionary supplies. The column name is also the input's id, which is how
 * the form finds the field to show.
 */
async function readError(res: Response, d: Dictionary): Promise<{ message: string; field?: string }> {
  const httpError = fill(d.settings.httpError, { status: res.status });
  try {
    const body = await res.json();
    if (body?.details && typeof body.details === "object") {
      const first = Object.entries(body.details as Record<string, string[]>)[0];
      if (first) {
        const labels = d.settings.fields as Record<string, string | undefined>;
        return { message: `${labels[first[0]] ?? first[0]}: ${first[1].join(", ")}`, field: first[0] };
      }
    }
    return { message: body?.message ?? httpError };
  } catch {
    return { message: httpError };
  }
}

/** "50, 80, 100" -> [50, 80, 100]. Blanks are dropped; anything else is passed on for the API to reject with a message. */
function parseMarks(text: string): number[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);
}

const primaryButtonClass =
  "inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50";

/**
 * The settings page body: a tab strip, the settings form spread over the
 * first four tabs, and the sharing and account panels, which save on their
 * own and are passed in already rendered.
 *
 * Every panel stays mounted and is only hidden, so switching tabs never loses
 * an edit. Saving is one request for all four form tabs; a bar at the foot of
 * the screen appears as soon as anything differs from what is saved, and each
 * tab holding a change carries a dot.
 *
 * `initial` is the row as the server page read it, so the form is filled in
 * from the first paint rather than after a round trip through /api/settings.
 */
export function SettingsForm({
  initial,
  initialTab,
  routerScript,
  sharing,
  account,
}: {
  initial: PublicSettings;
  initialTab: SettingsTab;
  routerScript: ReactNode;
  sharing: ReactNode;
  account: ReactNode;
}) {
  const { locale, d } = useI18n();
  const router = useRouter();
  const baseId = useId();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [saved, setSaved] = useState<FormState>(() => toForm(initial));
  const [form, setForm] = useState<FormState>(saved);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ToastState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  const changed = (Object.keys(form) as (keyof FormState)[]).filter((key) => form[key] !== saved[key]);
  const dirty = changed.length > 0;
  const dirtyTabs = new Set(changed.map((key) => FIELD_TAB[key]));

  // Leaving the page (reload, closing the tab, typing an address) with edits
  // pending asks first. Links inside the app are not covered by this.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const tabId = (t: SettingsTab) => `${baseId}-tab-${t}`;
  const panelId = (t: SettingsTab) => `${baseId}-panel-${t}`;

  /** Show a tab and put it in the address, so a reload or a shared link opens the same one. */
  function selectTab(next: SettingsTab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  /** Arrow keys move along the strip, in the reading direction; Home and End jump to either end. */
  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const count = SETTINGS_TABS.length;
    const index = SETTINGS_TABS.indexOf(tab);
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    let next: number;
    if (e.key === "ArrowRight") next = rtl ? index - 1 : index + 1;
    else if (e.key === "ArrowLeft") next = rtl ? index + 1 : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else return;
    e.preventDefault();
    const target = SETTINGS_TABS[(next + count) % count];
    selectTab(target);
    document.getElementById(tabId(target))?.focus();
  }

  /**
   * Bring a field into view: switch to the tab that holds it, then focus it
   * once the panel is no longer hidden. With no server message to show, the
   * browser's own validation bubble explains what is wrong.
   */
  function revealField(el: HTMLElement, explain: boolean) {
    const owner = el.closest<HTMLElement>("[data-tab]")?.dataset.tab;
    if (isSettingsTab(owner)) selectTab(owner);
    requestAnimationFrame(() => {
      el.focus();
      if (explain && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) el.reportValidity();
    });
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaveError(null);
  }

  function discard() {
    setForm(saved);
    setSaveError(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The form is not validated natively: a browser refuses to point at an
    // invalid field inside a hidden panel and just does nothing. It is checked
    // here instead, and the offending tab is opened.
    const invalid = e.currentTarget.querySelector<HTMLElement>(":invalid");
    if (invalid) {
      revealField(invalid, true);
      return;
    }

    setSaving(true);
    setSaveError(null);
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
        devices_enabled: form.devices_enabled,
        retention_days: Number(form.retention_days),
        stale_after_minutes: Number(form.stale_after_minutes),
        digest: form.digest,
        alert_thresholds: parseMarks(form.alert_thresholds),
        cycle_alert_thresholds: parseMarks(form.cycle_alert_thresholds),
        cycle_pace_alert: form.cycle_pace_alert,
        throttle_on_breach: form.throttle_on_breach,
        throttle_on_cap: form.throttle_on_cap,
      };
      const res = await fetch(`/api/settings?lang=${locale}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const { message, field } = await readError(res, d);
        setSaveError(fill(d.settings.saveFailed, { reason: message }));
        const el = field ? document.getElementById(field) : null;
        if (el) revealField(el, false);
        return;
      }
      const next = toForm((await res.json()) as PublicSettings);
      setSaved(next);
      setForm(next);
      setToast({ kind: "success", message: d.settings.saved });
      // The router script is rendered on the server from the saved interface
      // name, and the header's Devices link from the saved tracking switch.
      router.refresh();
    } catch (err) {
      setSaveError(
        fill(d.settings.saveFailed, { reason: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/test-email?lang=${locale}`, { method: "POST" });
      if (!res.ok) throw new Error((await readError(res, d)).message);
      const body = (await res.json()) as { to: string };
      setTestResult({ kind: "success", message: fill(d.settings.testSent, { address: body.to }) });
    } catch (err) {
      setTestResult({
        kind: "error",
        message: fill(d.settings.testFailed, {
          reason: err instanceof Error ? err.message : String(err),
        }),
      });
    } finally {
      setTesting(false);
    }
  }

  // The test goes to the saved address, so it waits until an edited one is saved.
  const canTest = saved.alert_email_to !== "" && form.alert_email_to === saved.alert_email_to;
  const t = d.settings.tabs;
  const labels: Record<SettingsTab, { label: string; hint: string }> = {
    limits: { label: t.limits, hint: t.limitsHint },
    alerts: { label: t.alerts, hint: t.alertsHint },
    router: { label: t.router, hint: t.routerHint },
    data: { label: t.data, hint: t.dataHint },
    sharing: { label: t.sharing, hint: t.sharingHint },
    account: { label: t.account, hint: t.accountHint },
  };

  function panel(id: SettingsTab, children: ReactNode) {
    return (
      <div
        role="tabpanel"
        id={panelId(id)}
        aria-labelledby={tabId(id)}
        data-tab={id}
        hidden={tab !== id}
        className="space-y-4"
      >
        <p className="text-sm text-muted">{labels[id].hint}</p>
        {children}
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* On a phone the strip scrolls sideways rather than wrapping, so the
          underline under the current tab always sits on one line. */}
      <div
        role="tablist"
        aria-label={d.settings.tabsLabel}
        className="-mx-4 flex overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        {SETTINGS_TABS.map((id) => {
          const selected = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={tabId(id)}
              aria-selected={selected}
              aria-controls={panelId(id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(id)}
              onKeyDown={onTabKeyDown}
              className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                selected
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted hover:border-border hover:text-foreground"
              }`}
            >
              {labels[id].label}
              {dirtyTabs.has(id) && (
                <>
                  <span aria-hidden className="size-1.5 rounded-full bg-status-warning" />
                  <span className="sr-only">{d.settings.unsaved}</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      <form onSubmit={onSubmit} noValidate>
        {panel(
          "limits",
          <>
            <SettingsCard title={d.settings.quotaSection} description={d.settings.quotaSectionHint}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="quota_gb" label={d.settings.quotaGb} hint={d.settings.quotaGbHint}>
                  <WithUnit unit={d.settings.units.gb}>
                    <input
                      id="quota_gb"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={form.quota_gb}
                      onChange={(e) => update("quota_gb", e.target.value)}
                      className={`${inputClass} pe-12`}
                    />
                  </WithUnit>
                </Field>
                <Field id="window_start" label={d.settings.windowStart}>
                  <input
                    id="window_start"
                    type="time"
                    required
                    value={form.window_start}
                    onChange={(e) => update("window_start", e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field id="window_end" label={d.settings.windowEnd}>
                  <input
                    id="window_end"
                    type="time"
                    required
                    value={form.window_end}
                    onChange={(e) => update("window_end", e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field id="timezone" label={d.settings.timezone} hint={d.settings.timezoneHint} className="sm:max-w-sm">
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
              </Field>
            </SettingsCard>

            <SettingsCard title={d.settings.monthlySection} description={d.settings.monthlySectionHint}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="monthly_quota_gb" label={d.settings.monthlyQuotaGb} hint={d.settings.monthlyQuotaGbHint}>
                  <WithUnit unit={d.settings.units.gb}>
                    <input
                      id="monthly_quota_gb"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={form.monthly_quota_gb}
                      onChange={(e) => update("monthly_quota_gb", e.target.value)}
                      className={`${inputClass} pe-12`}
                    />
                  </WithUnit>
                </Field>
                <Field id="billing_cycle_day" label={d.settings.billingCycleDay} hint={d.settings.billingCycleDayHint}>
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
                </Field>
              </div>
            </SettingsCard>
          </>,
        )}

        {panel(
          "alerts",
          <>
            <SettingsCard title={d.settings.emailCard}>
              <Field id="alert_email_to" label={d.settings.alertEmail} hint={d.settings.alertEmailHint}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <input
                    id="alert_email_to"
                    type="email"
                    dir="ltr"
                    autoComplete="email"
                    value={form.alert_email_to}
                    onChange={(e) => update("alert_email_to", e.target.value)}
                    className={`${inputClass} sm:max-w-sm`}
                    placeholder="name@example.com"
                  />
                  <button
                    type="button"
                    onClick={sendTest}
                    disabled={testing || !canTest}
                    className={`${secondaryButtonClass} shrink-0 sm:mt-1`}
                  >
                    {testing ? d.settings.sending : d.settings.sendTest}
                  </button>
                </div>
              </Field>
              <p
                role="status"
                aria-live="polite"
                className={`-mt-3 text-xs empty:hidden ${
                  testResult?.kind === "error" ? "text-status-critical" : "text-green-700 dark:text-status-good"
                }`}
              >
                {testResult?.message}
              </p>
              <Field id="language" label={d.settings.alertLanguage} hint={d.settings.alertLanguageHint} className="sm:max-w-sm">
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
              </Field>
            </SettingsCard>

            <SettingsCard title={d.settings.marksCard}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="alert_thresholds" label={d.settings.alertThresholds} hint={d.settings.alertThresholdsHint}>
                  <input
                    id="alert_thresholds"
                    type="text"
                    dir="ltr"
                    inputMode="decimal"
                    value={form.alert_thresholds}
                    onChange={(e) => update("alert_thresholds", e.target.value)}
                    className={`${inputClass} font-mono`}
                    placeholder="50, 80, 100"
                  />
                </Field>
                <Field
                  id="cycle_alert_thresholds"
                  label={d.settings.cycleAlertThresholds}
                  hint={d.settings.cycleAlertThresholdsHint}
                >
                  <input
                    id="cycle_alert_thresholds"
                    type="text"
                    dir="ltr"
                    inputMode="decimal"
                    value={form.cycle_alert_thresholds}
                    onChange={(e) => update("cycle_alert_thresholds", e.target.value)}
                    className={`${inputClass} font-mono`}
                    placeholder="80, 100"
                  />
                </Field>
              </div>
              <Switch
                checked={form.cycle_pace_alert}
                onChange={(v) => update("cycle_pace_alert", v)}
                label={d.settings.cyclePaceAlert}
                hint={d.settings.cyclePaceAlertHint}
              />
            </SettingsCard>

            <SettingsCard title={d.settings.scheduleSection} description={d.settings.scheduleSectionHint}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="stale_after_minutes"
                  label={d.settings.staleAfterMinutes}
                  hint={d.settings.staleAfterMinutesHint}
                >
                  <WithUnit unit={d.settings.units.minutes}>
                    <input
                      id="stale_after_minutes"
                      type="number"
                      min="0"
                      max="1440"
                      step="1"
                      required
                      value={form.stale_after_minutes}
                      onChange={(e) => update("stale_after_minutes", e.target.value)}
                      className={`${inputClass} pe-16`}
                    />
                  </WithUnit>
                </Field>
                <Field id="digest" label={d.settings.digest} hint={d.settings.digestHint}>
                  <select
                    id="digest"
                    value={form.digest}
                    onChange={(e) => update("digest", e.target.value)}
                    className={inputClass}
                  >
                    <option value="off">{d.settings.digestOff}</option>
                    <option value="weekly">{d.settings.digestWeekly}</option>
                    <option value="cycle">{d.settings.digestCycle}</option>
                  </select>
                </Field>
              </div>
            </SettingsCard>
          </>,
        )}

        {panel(
          "router",
          <>
            <SettingsCard title={d.settings.monitoringSection} description={d.settings.routerSectionHint}>
              <Switch
                checked={form.polling_enabled}
                onChange={(v) => update("polling_enabled", v)}
                label={form.polling_enabled ? d.settings.pollingEnabled : d.settings.pollingPaused}
                hint={d.settings.pollingHint}
              />
              <Field
                id="wan_interface_name"
                label={d.settings.wanInterfaceName}
                hint={<Interpolate template={d.settings.wanInterfaceNameHint} values={{ field: <code>iface</code> }} />}
                className="sm:max-w-sm"
              >
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
              </Field>
            </SettingsCard>

            <SettingsCard title={d.settings.devicesCard}>
              <Switch
                checked={form.devices_enabled}
                onChange={(v) => update("devices_enabled", v)}
                label={form.devices_enabled ? d.settings.devicesEnabled : d.settings.devicesDisabled}
                hint={
                  <Interpolate
                    template={d.settings.devicesHint}
                    values={{
                      script: <code>devices-push</code>,
                      setup: <code>router/devices-setup.rsc</code>,
                    }}
                  />
                }
              />
              {saved.devices_enabled && !form.devices_enabled && (
                <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm">
                  <Interpolate
                    template={d.settings.devicesUndo}
                    values={{ undo: <code>router/devices-undo.rsc</code> }}
                  />
                </p>
              )}
            </SettingsCard>

            <SettingsCard title={d.settings.enforcementSection} description={d.settings.enforcementSectionHint}>
              <Switch
                checked={form.throttle_on_breach}
                onChange={(v) => update("throttle_on_breach", v)}
                label={d.settings.throttleOnBreach}
                hint={d.settings.throttleOnBreachHint}
              />
              <Switch
                checked={form.throttle_on_cap}
                onChange={(v) => update("throttle_on_cap", v)}
                label={d.settings.throttleOnCap}
                hint={d.settings.throttleOnCapHint}
              />
            </SettingsCard>

            {routerScript}
          </>,
        )}

        {panel(
          "data",
          <SettingsCard title={d.settings.retentionCard}>
            <Field
              id="retention_days"
              label={d.settings.retentionDays}
              hint={d.settings.retentionDaysHint}
              className="sm:max-w-xs"
            >
              <WithUnit unit={d.settings.units.days}>
                <input
                  id="retention_days"
                  type="number"
                  min="7"
                  max="3650"
                  step="1"
                  required
                  value={form.retention_days}
                  onChange={(e) => update("retention_days", e.target.value)}
                  className={`${inputClass} pe-16`}
                />
              </WithUnit>
            </Field>
            <Link
              href={`/${locale}/export`}
              className="inline-flex items-center gap-1 text-sm font-medium text-series-1 hover:underline"
            >
              {d.settings.exportLink}
              <span aria-hidden className="rtl:rotate-180">
                &rarr;
              </span>
            </Link>
          </SettingsCard>,
        )}

        {dirty && (
          <div
            data-unsaved-bar
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur"
          >
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
              <p role="status" aria-live="polite" className="min-w-0 flex-1 text-sm">
                {saveError ? (
                  <span className="text-status-critical">{saveError}</span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="size-2 rounded-full bg-status-warning" />
                    {d.settings.unsaved}
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={discard} disabled={saving} className={secondaryButtonClass}>
                  {d.settings.discard}
                </button>
                <button type="submit" disabled={saving} className={primaryButtonClass}>
                  {saving ? d.settings.saving : d.settings.save}
                </button>
              </div>
            </div>
          </div>
        )}
      </form>

      {panel("sharing", sharing)}
      {panel("account", account)}

      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}

/** A label, its control and the line explaining it. */
function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  );
}

/**
 * The unit written inside the end of a number box, so the label does not have
 * to carry it. The input leaves room for it with end padding; `top-1` matches
 * the input's own top margin so the unit centres on the box, not the wrapper.
 */
function WithUnit({ unit, children }: { unit: string; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute end-3 top-1 bottom-0 flex items-center text-xs text-muted">
        {unit}
      </span>
    </div>
  );
}

/**
 * An on/off setting: the switch, its label, and a line explaining it.
 *
 * Not a `<label>` around a `<button>`. A button is not a labelable element, so
 * a wrapping label neither names it -- a screen reader announced a bare
 * "switch, on" -- nor forwards a click on the text to it, which left the words
 * beside every switch looking clickable and doing nothing. The button is named
 * by the label and described by the hint through ids, and the text forwards
 * its own click. Keyboard users reach the button itself, as with any label.
 */
function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  hint: ReactNode;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const toggle = () => onChange(!checked);

  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        onClick={toggle}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-series-1" : "bg-border"
        }`}
      >
        {/* The knob travels towards the end of the line, so in Arabic it
            slides left. Mirroring the movement is the point of the control:
            "on" is always the far side from where the eye starts. */}
        <span
          className={`absolute top-0.5 start-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5 rtl:-translate-x-5" : ""
          }`}
        />
      </button>
      {/* Pointer convenience only, as a native label is: the button above is
          the control, and the one a keyboard or a screen reader operates. */}
      <span className="cursor-pointer text-sm font-medium" onClick={toggle}>
        <span id={labelId}>{label}</span>
        <span id={hintId} className="mt-0.5 block text-xs font-normal text-muted">
          {hint}
        </span>
      </span>
    </div>
  );
}
