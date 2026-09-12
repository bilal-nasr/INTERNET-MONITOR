"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Toast, type ToastState } from "@/components/Toast";
import {
  hintClass,
  inputClass,
  labelClass,
  readApiError,
  secondaryButtonClass,
} from "@/components/auth/fields";
import type { PublicUser } from "@/lib/auth/users";
import { fill } from "@/lib/i18n";

/**
 * The account section of the settings page: the address a reset link goes to,
 * and the password. Two separate forms, so saving one never sends the other.
 */
export function AccountForm({ user }: { user: PublicUser }) {
  const { locale, d } = useI18n();
  const a = d.auth.account;
  const [email, setEmail] = useState(user.email ?? "");
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
    <section className="space-y-6 rounded-xl border border-border bg-surface p-5">
      <div>
        <h2 className="text-base font-semibold">{a.section}</h2>
        <p className="text-sm text-muted">{a.sectionHint}</p>
      </div>

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
        <button type="submit" disabled={savingEmail} className={secondaryButtonClass}>
          {savingEmail ? d.settings.saving : a.saveEmail}
        </button>
      </form>

      <form onSubmit={changePassword} className="space-y-4 border-t border-border pt-6" noValidate>
        <h3 className="text-sm font-semibold">{a.changePassword}</h3>
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
        <p className={hintClass}>{a.passwordHint}</p>
        <button
          type="submit"
          disabled={savingPassword || !current || !next || !confirm}
          className={secondaryButtonClass}
        >
          {savingPassword ? a.updating : a.updatePassword}
        </button>
      </form>

      <Toast toast={toast} onDismiss={dismiss} />
    </section>
  );
}
