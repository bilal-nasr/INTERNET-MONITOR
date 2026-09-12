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
  /**
   * The written log row, or null in exactly one case: the mail was sent
   * successfully but the `alerts` INSERT that records it then failed. That
   * failure is swallowed (logged loudly, not thrown) so the caller keeps its
   * claim instead of releasing it and re-sending the same real email on the
   * next push - see the note on the "sent" path below. Every other status
   * ("failed", "skipped") always carries a real row.
   */
  row: AlertLogRow | null;
}

/**
 * Send one message and record the outcome. A send failure is not an exception
 * here: it is the row's status, so the caller can release whatever claim it
 * made and the history page can show what went wrong. Only a failure to write
 * the log row itself throws - except when the mail has already been sent: see
 * below.
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
    // The mail is now out. From here a failure to log it must never look like
    // a failure to send: the caller's catch block releases its claim on any
    // throw, and a released claim is re-claimed and re-mailed on the next
    // push. Losing this log row is preferable to mailing a real person twice,
    // so the write is attempted but its failure is contained here.
    try {
      const row = await recordAlert({ ...base, status: "sent", payload: { ...base.payload, provider_id: id } });
      return { status: "sent", row };
    } catch (logErr) {
      const message = logErr instanceof Error ? logErr.message : String(logErr);
      console.error(
        `[alerts] ${input.kind} for ${input.scopeKey} sent but the log write failed (row lost): ${message}`,
      );
      return { status: "sent", row: null };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[alerts] ${input.kind} for ${input.scopeKey} failed: ${message}`);
    const row = await recordAlert({ ...base, status: "failed", error: message.slice(0, 1000) });
    return { status: "failed", row };
  }
}
