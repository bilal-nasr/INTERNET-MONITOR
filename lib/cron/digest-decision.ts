/**
 * The digest job's "does the newest alert row still count as sent" decision,
 * pulled out of lib/cron/digest.ts so it can be unit-tested without a
 * database - mirroring lib/cron/stale-decision.ts for the stale job.
 *
 * A digest period is a week or a whole billing cycle long, so treating every
 * prior row as proof a digest went out would be far worse here than for the
 * stale job's short retry loop: one `failed` row (an unset RESEND_API_KEY)
 * would otherwise silence the digest for the rest of the period, and one
 * `skipped` row (no recipient configured) would silence it just as long even
 * after the recipient is fixed the same day.
 *
 * So only a row that actually reached `sent` blocks for the rest of the
 * period. A `failed` row blocks only for FAILED_SEND_COOLDOWN_MS - the same
 * cooldown dispatchAlert's other callers use via inFailureCooldown - so a
 * fixed misconfiguration is retried within minutes rather than at the next
 * scheduled instant. A `skipped` row never blocks, matching
 * inFailureCooldown's own treatment of a skip: there was nothing to fail, so
 * every tick is free to try again once a recipient is configured.
 */

import { FAILED_SEND_COOLDOWN_MS } from "@/lib/alerts/dispatch";
import type { AlertStatus } from "@/lib/alerts/log";

export interface DigestAlertRow {
  status: AlertStatus;
  created_at: Date;
}

/**
 * The `lastSentAt` isDigestDue should see: the newest digest row's
 * created_at when it still counts as sent, or null when it does not (never
 * sent, a skipped attempt, or a failed attempt whose cooldown has elapsed).
 */
export function effectiveLastSentAt(last: DigestAlertRow | null, now: Date): Date | null {
  if (!last) return null;
  if (last.status === "sent") return last.created_at;
  if (last.status === "failed" && now.getTime() - last.created_at.getTime() < FAILED_SEND_COOLDOWN_MS) {
    return last.created_at;
  }
  return null;
}
