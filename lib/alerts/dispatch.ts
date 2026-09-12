import { recordAlert, type AlertKind, type AlertLogRow, type AlertStatus } from "@/lib/alerts/log";
import { sendRendered } from "@/lib/email";
import type { RenderedEmail } from "@/lib/email-template";

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
