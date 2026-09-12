"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Toast, type ToastState } from "@/components/Toast";
import { inputClass, labelClass, readApiError, secondaryButtonClass } from "@/components/auth/fields";
import { SettingsCard } from "@/components/settings/SettingsCard";
import type { PublicUser } from "@/lib/auth/users";
import { fill } from "@/lib/i18n";

/**
 * The account tab of the settings page: the address a reset link goes to, and
 * the password. Two separate cards and forms, so saving one never sends the other.
 */
export function AccountForm({ user }: { user: PublicUser }) {
  const { locale, d } = useI18n();
  const a = d.auth.account;
  const [email, setEmail] = useState(user.email ?? "");
  const [savedEmail, setSavedEmail] = useState(user.email ?? "");
  const [savingEmail, setSavingEmail] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  async function saveEmail(e: FormEvent) {
    e.preventDefault();
    setSavingEmail(true);
    try {
      const res = await fetch(`/api/auth/account?lang=${locale}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() === "" ? null : email.trim() }),
      });
      if (!res.ok) {
        setToast({ kind: "error", message: await readApiError(res, fill(d.settings.httpError, { status: res.status })) });
        return;
      }
      setSavedEmail(email.trim());
      setToast({ kind: "success", message: a.emailSaved });
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingEmail(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setToast({ kind: "error", message: d.errors.passwordMismatch });
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch(`/api/auth/password?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next, confirm_password: confirm }),
      });
      if (!res.ok) {
        setToast({ kind: "error", message: await readApiError(res, fill(d.settings.httpError, { status: res.status })) });
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setToast({ kind: "success", message: a.passwordChanged });
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <>
      <SettingsCard title={a.section} description={a.sectionHint}>
        <form onSubmit={saveEmail} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="account-username" className={labelClass}>
                {a.username}
              </label>
              <input id="account-username" value={user.username} readOnly className={`${inputClass} text-muted`} />
            </div>
            <div>
              <label htmlFor="account-email" className={labelClass}>
                {a.email}
              </label>
              <input
                id="account-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={savingEmail || email.trim() === savedEmail}
            className={secondaryButtonClass}
          >
            {savingEmail ? d.settings.saving : a.saveEmail}
          </button>
        </form>
      </SettingsCard>

      <SettingsCard title={a.changePassword} description={a.passwordHint}>
        <form onSubmit={changePassword} className="space-y-4" noValidate>
          {/* Not shown; it tells a password manager which account the new password belongs to. */}
          <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="current-password" className={labelClass}>
                {a.currentPassword}
              </label>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="new-password" className={labelClass}>
                {a.newPassword}
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="confirm-new-password" className={labelClass}>
                {a.confirmPassword}
              </label>
              <input
                id="confirm-new-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={savingPassword || !current || !next || !confirm}
            className={secondaryButtonClass}
          >
            {savingPassword ? a.updating : a.updatePassword}
          </button>
        </form>
      </SettingsCard>

      <Toast toast={toast} onDismiss={dismiss} />
    </>
  );
}
