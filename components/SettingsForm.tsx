"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Toast, type ToastState } from "@/components/Toast";
import type { PublicSettings } from "@/lib/settings";

interface FormState {
  quota_gb: string;
  window_start: string;
  window_end: string;
  timezone: string;
  alert_email_to: string;
  wan_interface_name: string;
  router_host: string;
  router_user: string;
  router_pass: string;
  polling_enabled: boolean;
}

function toForm(s: PublicSettings): FormState {
  return {
    quota_gb: String(s.quota_gb),
    window_start: s.window_start,
    window_end: s.window_end,
    timezone: s.timezone,
    alert_email_to: s.alert_email_to ?? "",
    wan_interface_name: s.wan_interface_name,
    router_host: s.router_host ?? "",
    router_user: s.router_user ?? "",
    router_pass: "",
    polling_enabled: s.polling_enabled,
  };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body?.details && typeof body.details === "object") {
      const first = Object.entries(body.details as Record<string, string[]>)[0];
      if (first) return `${first[0]}: ${first[1].join(", ")}`;
    }
    return body?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-series-1 focus:ring-2 focus:ring-series-1/30";
const labelClass = "block text-sm font-medium";
const hintClass = "mt-1 text-xs text-muted";

export function SettingsForm() {
  const [form, setForm] = useState<FormState | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return (await res.json()) as PublicSettings;
      })
      .then((s) => {
        if (cancelled) return;
        setForm(toForm(s));
        setHasPassword(s.has_password_set);
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

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
        window_start: form.window_start,
        window_end: form.window_end,
        timezone: form.timezone,
        alert_email_to: form.alert_email_to.trim() || null,
        wan_interface_name: form.wan_interface_name,
        router_host: form.router_host.trim() || null,
        router_user: form.router_user.trim() || null,
        // Empty string = keep the stored password.
        router_pass: form.router_pass,
        polling_enabled: form.polling_enabled,
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res));
      const saved = (await res.json()) as PublicSettings;
      setForm(toForm(saved));
      setHasPassword(saved.has_password_set);
      setToast({ kind: "success", message: "Settings saved." });
    } catch (err) {
      setToast({ kind: "error", message: `Save failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/test-email", { method: "POST" });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { to: string };
      setToast({ kind: "success", message: `Test email sent to ${body.to}.` });
    } catch (err) {
      setToast({ kind: "error", message: `Test email failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setTesting(false);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-status-critical/40 bg-status-critical/5 p-5 text-sm">
        <p className="font-medium text-status-critical">Could not load settings</p>
        <p className="mt-1 text-muted">{loadError}</p>
      </div>
    );
  }
  if (!form) {
    return <p className="text-sm text-muted">Loading settings...</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <Section title="Quota" description="Usage inside this daily window counts against the quota. Times are in the timezone below.">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="quota_gb" className={labelClass}>Quota (GB)</label>
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
            <p className={hintClass}>1 GB = 1,000,000,000 bytes</p>
          </div>
          <div>
            <label htmlFor="window_start" className={labelClass}>Window start</label>
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
            <label htmlFor="window_end" className={labelClass}>Window end</label>
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
          <label htmlFor="timezone" className={labelClass}>Timezone</label>
          <input
            id="timezone"
            type="text"
            required
            list="tz-list"
            value={form.timezone}
            onChange={(e) => update("timezone", e.target.value)}
            className={inputClass}
            placeholder="e.g. Asia/Beirut"
          />
          <datalist id="tz-list">
            {typeof Intl.supportedValuesOf === "function" &&
              Intl.supportedValuesOf("timeZone").map((tz) => <option key={tz} value={tz} />)}
          </datalist>
          <p className={hintClass}>IANA name. Determines which day a reading belongs to and when the window opens.</p>
        </div>
      </Section>

      <Section title="Alerts">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 sm:max-w-sm">
            <label htmlFor="alert_email_to" className={labelClass}>Alert email</label>
            <input
              id="alert_email_to"
              type="email"
              value={form.alert_email_to}
              onChange={(e) => update("alert_email_to", e.target.value)}
              className={inputClass}
              placeholder="me@example.com"
            />
          </div>
          <button
            type="button"
            onClick={sendTest}
            disabled={testing || !form.alert_email_to}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-border/60 disabled:opacity-50"
          >
            {testing ? "Sending..." : "Send test email"}
          </button>
        </div>
        <p className={hintClass}>The test goes to the saved address. Save first if you just changed it.</p>
      </Section>

      <Section
        title="Router"
        description="Pull mode: the app fetches counters from the RouterOS REST API. Leave the host empty if the router pushes readings to /api/ingest instead (needed behind CGNAT, see README). The password is stored server-side and never sent back to the browser."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="router_host" className={labelClass}>Router host (pull mode only)</label>
            <input
              id="router_host"
              type="url"
              value={form.router_host}
              onChange={(e) => update("router_host", e.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="https://xxxxxxxx.sn.mynetname.net"
            />
          </div>
          <div>
            <label htmlFor="router_user" className={labelClass}>Username</label>
            <input
              id="router_user"
              type="text"
              autoComplete="off"
              value={form.router_user}
              onChange={(e) => update("router_user", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="router_pass" className={labelClass}>Password</label>
            <input
              id="router_pass"
              type="password"
              autoComplete="new-password"
              value={form.router_pass}
              onChange={(e) => update("router_pass", e.target.value)}
              className={inputClass}
              placeholder={hasPassword ? "(unchanged)" : "not set"}
            />
            <p className={hintClass}>
              {hasPassword ? "A password is stored. Leave blank to keep it." : "No password stored yet."}
            </p>
          </div>
          <div>
            <label htmlFor="wan_interface_name" className={labelClass}>WAN interface name</label>
            <input
              id="wan_interface_name"
              type="text"
              required
              value={form.wan_interface_name}
              onChange={(e) => update("wan_interface_name", e.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="ISP-ether1"
            />
          </div>
        </div>
      </Section>

      <Section title="Monitoring">
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
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                form.polling_enabled ? "translate-x-5" : ""
              }`}
            />
          </button>
          <span className="text-sm">
            Polling {form.polling_enabled ? "enabled" : "paused"}
            <span className="block text-xs text-muted">
              When paused, /api/poll exits immediately and records nothing. History is kept.
            </span>
          </span>
        </label>
      </Section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save settings"}
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
