"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Toast, type ToastState } from "@/components/Toast";
import { primaryButtonClass, readApiError } from "@/components/auth/fields";
import { fill } from "@/lib/i18n";

interface ImportOutcome {
  inserted: number;
  skipped: number;
  rejected: number;
  errors: string[];
}

/** Only the three counts belong in the sentence; `errors` is listed separately. */
function counts(outcome: ImportOutcome): Record<string, number> {
  return { inserted: outcome.inserted, skipped: outcome.skipped, rejected: outcome.rejected };
}

/**
 * Reads the chosen file in the browser and posts its text, so the route sees
 * one body with one content type and never has to unpack a multipart form.
 */
export function ImportForm() {
  const { locale, d } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setToast({ kind: "error", message: d.import.pickFile });
      return;
    }
    setBusy(true);
    setOutcome(null);
    try {
      const text = await file.text();
      const isJson = file.name.toLowerCase().endsWith(".json") || text.trimStart().startsWith("[");
      const res = await fetch(`/api/import?lang=${locale}`, {
        method: "POST",
        headers: { "Content-Type": isJson ? "application/json" : "text/csv" },
        body: text,
      });
      if (!res.ok) {
        setToast({
          kind: "error",
          message: await readApiError(res, fill(d.settings.httpError, { status: res.status })),
        });
        return;
      }
      const body = (await res.json()) as ImportOutcome;
      setOutcome(body);
      setToast({ kind: "success", message: fill(d.import.result, counts(body)) });
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">{d.import.title}</h2>
      <p className="mt-1 text-sm text-muted">{d.import.subtitle}</p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 sm:max-w-md">
          <label htmlFor="import-file" className="block text-sm font-medium">
            {d.import.chooseFile}
          </label>
          <input
            id="import-file"
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-muted file:me-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          />
        </div>
        <button type="submit" disabled={busy || !file} className={`${primaryButtonClass} sm:w-auto`}>
          {busy ? d.import.uploading : d.import.upload}
        </button>
      </form>
      <p className="mt-3 text-xs text-muted">{d.import.notImported}</p>

      {outcome && (
        <div className="mt-4 text-sm">
          <p>{fill(d.import.result, counts(outcome))}</p>
          {outcome.errors.length > 0 && (
            <>
              <p className="mt-2 text-xs font-medium text-muted">{d.import.problems}</p>
              <ul className="mt-1 list-disc ps-5 font-mono text-xs text-status-critical" dir="ltr">
                {outcome.errors.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <Toast toast={toast} onDismiss={dismiss} />
    </section>
  );
}
