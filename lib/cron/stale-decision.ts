/**
 * The stale job's branch selection, pulled out of lib/cron/stale.ts so the
 * four-way decision can be unit-tested without a database. Pure: it takes the
 * alert log's own rows (never queries them) plus a clock and the reading it
 * cares about, and says which of the two mails - if either - is due.
 *
 * A `link_stale` row only counts as "the outage is currently being reported"
 * while a real notice is outstanding:
 *  - `sent` blocks a repeat send until a `link_recovered` clears it;
 *  - `failed` blocks only for FAILED_SEND_COOLDOWN_MS - the same cooldown
 *    dispatchAlert's other callers (lib/alerts/cycle.ts, lib/readings.ts) use
 *    via inFailureCooldown - so an unset RESEND_API_KEY or a transient
 *    provider outage does not silence a real outage forever;
 *  - `skipped` (no recipient configured) never blocks, matching
 *    inFailureCooldown's own treatment of a skip: there was nothing to fail,
 *    so every tick is free to try again once a recipient is configured.
 *
 * The recovery mail only fires once a `link_stale` row actually reached
 * `sent`: a failed or skipped attempt never told anyone the router was
 * down, so there is nothing for a `link_recovered` to close out.
 */

import { FAILED_SEND_COOLDOWN_MS } from "@/lib/alerts/dispatch";
import type { AlertStatus } from "@/lib/alerts/log";
import { isStale } from "@/lib/cron/schedule";

export interface StaleAlertRow {
  status: AlertStatus;
  created_at: Date;
  payload: Record<string, unknown> | null;
}

export interface DecideStaleActionInput {
  now: Date;
  /** Settings' stale_after_minutes; 0 disables the whole check. */
  staleAfterMinutes: number;
  /** The newest stored reading's timestamp, or null when none was ever stored. */
  lastReadingAt: Date | null;
  /** The newest `link_stale` alert row for scope "link", or null if never sent. */
  lastStale: StaleAlertRow | null;
  /** The newest `link_recovered` alert row for scope "link", or null if never sent. */
  lastRecovered: { created_at: Date } | null;
}

export type StaleAction = "send_stale" | "send_recovered" | "skip";

export function decideStaleAction(input: DecideStaleActionInput): StaleAction {
  const { now, staleAfterMinutes, lastReadingAt, lastStale, lastRecovered } = input;

  if (staleAfterMinutes <= 0) return "skip";

  const stale = isStale(lastReadingAt, now, staleAfterMinutes);

  const staleRowBlocks =
    lastStale !== null &&
    (lastStale.status === "sent" ||
      (lastStale.status === "failed" && now.getTime() - lastStale.created_at.getTime() < FAILED_SEND_COOLDOWN_MS));

  // An outage is "open" when the newest link_stale row still stands (per
  // staleRowBlocks above) and is newer than both the newest link_recovered
  // row and the newest reading: nothing has arrived since we complained.
  const outageOpen =
    staleRowBlocks &&
    (lastRecovered === null || lastStale!.created_at > lastRecovered.created_at) &&
    (lastReadingAt === null || lastStale!.created_at > lastReadingAt);

  // True once a link_stale row actually reached "sent" and no later
  // link_recovered has cleared it yet - regardless of whether a fresh
  // reading has since arrived. This intentionally omits the third clause
  // above: the moment a reading lands after a sent stale alert, outageOpen
  // already flips false on its own, and that is exactly when the recovery
  // branch below needs to fire.
  const reportedAndNotCleared =
    lastStale !== null &&
    lastStale.status === "sent" &&
    (lastRecovered === null || lastStale.created_at > lastRecovered.created_at);

  if (stale && !outageOpen) return "send_stale";
  if (!stale && reportedAndNotCleared && lastReadingAt) return "send_recovered";
  return "skip";
}
