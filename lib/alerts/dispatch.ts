import { latestAlert, recordAlert, type AlertKind, type AlertLogRow, type AlertStatus } from "@/lib/alerts/log";
import { sendRendered } from "@/lib/email";
import type { RenderedEmail } from "@/lib/email-template";

/**
 * How long to leave a kind and scope alone after a send failed.
 *
 * A failed send is far more often a misconfiguration than an outage - an unset
 * RESEND_API_KEY, an ALERT_EMAIL_FROM on an unverified domain - and those fail
 * identically on every attempt. Since a claim is released when the send fails,
 * the mark is due again on the next push thirty seconds later, which would
 * rebuild the report (six aggregates), call Resend and write another `failed`
 * row, forever. Fifteen minutes costs a real outage at most one mark's delay
 * and turns 2,880 futile attempts a day into 96.
 */
export const FAILED_SEND_COOLDOWN_MS = 15 * 60_000;

/**
 * True when the newest logged attempt for this kind and scope failed less than
 * the cooldown ago. Callers check this *before* claiming a mark, so a skipped
 * attempt leaves the claim state untouched and a later push retries it.
 */
export async function inFailureCooldown(kind: AlertKind, scopeKey: string, now = new Date()): Promise<boolean> {
  const last = await latestAlert(kind, scopeKey);
  if (!last || last.status !== "failed") return false;
  return now.getTime() - last.created_at.getTime() < FAILED_SEND_COOLDOWN_MS;
}

export interface DispatchInput {
  kind: AlertKind;
  level: number | null;
  scopeKey: string;
  /** Null when no address is configured: recorded as skipped, nothing sent. */
  to: string | null;
  email: RenderedEmail;
  payload?: Record<string, unknown> | null;
}

export interface DispatchResult {
  status: AlertStatus;
  row: AlertLogRow;
}

/**
 * Send one message and record the outcome. A send failure is not an exception
 * here: it is the row's status, so the caller can release whatever claim it
 * made and the history page can show what went wrong. Only a failure to write
 * the log row itself throws.
 */
export async function dispatchAlert(input: DispatchInput): Promise<DispatchResult> {
  const base = {
    kind: input.kind,
    level: input.level,
    scopeKey: input.scopeKey,
    recipient: input.to,
    subject: input.email.subject,
    payload: input.payload ?? null,
  };

  if (!input.to) {
    console.warn(`[alerts] ${input.kind} for ${input.scopeKey} skipped: no alert email is set`);
    const row = await recordAlert({ ...base, status: "skipped", error: "no recipient configured" });
    return { status: "skipped", row };
  }

  try {
    const id = await sendRendered(input.to, input.email);
    const row = await recordAlert({ ...base, status: "sent", payload: { ...base.payload, provider_id: id } });
    return { status: "sent", row };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[alerts] ${input.kind} for ${input.scopeKey} failed: ${message}`);
    const row = await recordAlert({ ...base, status: "failed", error: message.slice(0, 1000) });
    return { status: "failed", row };
  }
}
