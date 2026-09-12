import { formatBytes } from "@/lib/format";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { SessionSummary } from "@/lib/sessions";
import type { TodayUsage } from "@/lib/usage";

/**
 * Ten missed pushes at the default 30-second interval. Used only when the
 * "router has gone quiet" alert is switched off (stale_after_minutes = 0) and
 * the card therefore has no configured limit to follow.
 */
const SILENT_AFTER_SECONDS = 300;

type LinkState =
  | { kind: "up"; session: SessionSummary }
  | { kind: "down"; session: SessionSummary }
  | { kind: "silent"; session: SessionSummary }
  | { kind: "unknown" };

function linkState(session: SessionSummary | null, silentAfterSeconds: number): LinkState {
  if (!session) return { kind: "unknown" };
  // An open session we have not heard about in minutes means the router itself
  // went away: it never got to tell us the link dropped, so "Live" would be a
  // claim we cannot support.
  if (session.open) {
    return session.seconds_since_seen > silentAfterSeconds
      ? { kind: "silent", session }
      : { kind: "up", session };
  }
  return { kind: "down", session };
}

export async function StatusCard({
  usage,
  pollingEnabled,
  interfaceName,
  session = null,
  staleAfterMinutes = 0,
  staleAlertAt = null,
}: {
  usage: TodayUsage;
  pollingEnabled: boolean;
  interfaceName: string;
  /** The newest session, open or closed. */
  session?: SessionSummary | null;
  /**
   * settings.stale_after_minutes, so "No contact" appears exactly when the
   * mail would go out rather than at a threshold of its own; 0 (the alert
   * switched off) falls back to SILENT_AFTER_SECONDS.
   */
  staleAfterMinutes?: number;
  /** When the newest "router has gone quiet" mail was sent, or null. */
  staleAlertAt?: string | null;
}) {
  const { d, f } = await getI18n();
  const state = linkState(session, staleAfterMinutes > 0 ? staleAfterMinutes * 60 : SILENT_AFTER_SECONDS);
  const ageMinutes = usage.last_reading
    ? Math.round(
        (new Date(usage.generated_at).getTime() - new Date(usage.last_reading.recorded_at).getTime()) / 60_000,
      )
    : null;

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium text-muted">{d.router.heading}</h2>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted">{d.router.link}</dt>
          {state.kind === "up" && (
            <>
              <dd className="font-medium text-green-700 dark:text-status-good">
                {fill(d.router.upFor, { duration: f.duration(state.session.uptime_seconds) })}
              </dd>
              <dd className="text-xs tabular-nums text-muted">
                {fill(d.router.sinceTime, {
                  bytes: formatBytes(state.session.total_bytes),
                  time: f.stamp(state.session.started_at, usage.timezone),
                })}
              </dd>
            </>
          )}
          {state.kind === "down" && (
            <>
              <dd className="font-medium text-status-critical">
                &#9888;{" "}
                {fill(d.router.downSince, {
                  time: f.stamp(state.session.ended_at!, usage.timezone),
                })}
              </dd>
              <dd className="text-xs text-muted">
                {fill(d.router.downExplanation, {
                  duration: f.duration(state.session.seconds_since_seen),
                })}
              </dd>
            </>
          )}
          {state.kind === "silent" && (
            <>
              <dd className="font-medium text-status-critical">&#9888; {d.router.noContact}</dd>
              <dd className="text-xs text-muted">
                {fill(d.router.noContactExplanation, {
                  duration: f.duration(state.session.seconds_since_seen),
                })}
              </dd>
              <dd className="text-xs text-muted">{d.router.causeAfterReconnect}</dd>
              {staleAlertAt &&
                usage.last_reading &&
                new Date(staleAlertAt) > new Date(usage.last_reading.recorded_at) && (
                  <dd className="text-xs text-muted">
                    {fill(d.router.staleAlertSent, { time: f.stamp(staleAlertAt, usage.timezone) })}
                  </dd>
                )}
            </>
          )}
          {state.kind === "unknown" && (
            <dd className="font-medium text-muted">{d.router.noSessionYet}</dd>
          )}
          <dd className="mt-1 truncate text-xs text-muted">
            {fill(d.router.interface, { name: interfaceName })}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-muted">{d.router.lastReading}</dt>
          {/* Flex, so the gap sits between the two runs whichever way the line
              runs; a margin would have to pick a side and bidi decides which
              side is which. */}
          <dd className="flex flex-wrap items-baseline gap-2 font-medium">
            <span>
              {usage.last_reading
                ? f.stamp(usage.last_reading.recorded_at, usage.timezone)
                : d.common.never}
            </span>
            {ageMinutes !== null && (
              <span className="text-xs font-normal text-muted">
                {ageMinutes < 1
                  ? d.common.justNow
                  : fill(d.common.minutesAgo, { minutes: ageMinutes })}
              </span>
            )}
          </dd>
          {usage.last_reading && (
            <dd className="text-xs tabular-nums text-muted">
              {fill(d.router.txRx, {
                tx: formatBytes(usage.last_reading.tx_bytes),
                rx: formatBytes(usage.last_reading.rx_bytes),
              })}
            </dd>
          )}
          {pollingEnabled && !usage.last_reading && (
            <dd className="mt-1 text-xs text-muted">{d.router.waitingFirstReading}</dd>
          )}
        </div>

        <div>
          <dt className="text-xs text-muted">{d.router.monitoring}</dt>
          <dd className={`font-medium ${pollingEnabled ? "" : "text-amber-700 dark:text-status-warning"}`}>
            {pollingEnabled ? d.router.monitoringEnabled : d.router.monitoringPaused}
          </dd>
        </div>
      </dl>
    </section>
  );
}
