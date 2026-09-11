import { formatBytes } from "@/lib/format";
import type { SessionSummary } from "@/lib/sessions";
import { formatDuration } from "@/lib/time";
import type { TodayUsage } from "@/lib/usage";
import { formatTime } from "@/components/UsageProgress";

/**
 * Ten missed pushes at the default 30-second interval. Past this the router is
 * not talking to us, and whatever it last said about the link is no longer
 * something we can vouch for.
 */
const SILENT_AFTER_SECONDS = 300;

type LinkState =
  | { kind: "up"; session: SessionSummary }
  | { kind: "down"; session: SessionSummary }
  | { kind: "silent"; session: SessionSummary }
  | { kind: "unknown" };

function linkState(session: SessionSummary | null): LinkState {
  if (!session) return { kind: "unknown" };
  // An open session we have not heard about in minutes means the router itself
  // went away: it never got to tell us the link dropped, so "Live" would be a
  // claim we cannot support.
  if (session.open) {
    return session.seconds_since_seen > SILENT_AFTER_SECONDS
      ? { kind: "silent", session }
      : { kind: "up", session };
  }
  return { kind: "down", session };
}

export function StatusCard({
  usage,
  pollingEnabled,
  interfaceName,
  session = null,
}: {
  usage: TodayUsage;
  pollingEnabled: boolean;
  interfaceName: string;
  /** The newest session, open or closed. */
  session?: SessionSummary | null;
}) {
  const state = linkState(session);
  const ageMinutes = usage.last_reading
    ? Math.round(
        (new Date(usage.generated_at).getTime() - new Date(usage.last_reading.recorded_at).getTime()) / 60_000,
      )
    : null;

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium text-muted">Router</h2>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Link</dt>
          {state.kind === "up" && (
            <>
              <dd className="font-medium text-green-700 dark:text-status-good">
                Up for {formatDuration(state.session.uptime_seconds)}
              </dd>
              <dd className="text-xs tabular-nums text-muted">
                {formatBytes(state.session.total_bytes)} since{" "}
                {formatTime(state.session.started_at, usage.timezone)}
              </dd>
            </>
          )}
          {state.kind === "down" && (
            <>
              <dd className="font-medium text-status-critical">
                &#9888; Down since {formatTime(state.session.ended_at!, usage.timezone)}
              </dd>
              <dd className="text-xs text-muted">
                Offline for {formatDuration(state.session.seconds_since_seen)}. The router reported the
                drop and will report again when the link returns.
              </dd>
            </>
          )}
          {state.kind === "silent" && (
            <>
              <dd className="font-medium text-status-critical">&#9888; No contact with the router</dd>
              <dd className="text-xs text-muted">
                Nothing heard for {formatDuration(state.session.seconds_since_seen)}. The router is off,
                unreachable, or its script has stopped. The last session is shown as it was left.
              </dd>
            </>
          )}
          {state.kind === "unknown" && (
            <dd className="font-medium text-muted">No session recorded yet</dd>
          )}
          <dd className="mt-1 truncate text-xs text-muted">interface {interfaceName}</dd>
        </div>

        <div>
          <dt className="text-xs text-muted">Last reading</dt>
          <dd className="font-medium">
            {usage.last_reading ? formatTime(usage.last_reading.recorded_at, usage.timezone) : "never"}
            {ageMinutes !== null && (
              <span className="ml-2 text-xs font-normal text-muted">
                {ageMinutes < 1 ? "just now" : `${ageMinutes} min ago`}
              </span>
            )}
          </dd>
          {usage.last_reading && (
            <dd className="text-xs tabular-nums text-muted">
              tx {formatBytes(usage.last_reading.tx_bytes)} / rx {formatBytes(usage.last_reading.rx_bytes)}
            </dd>
          )}
          {pollingEnabled && !usage.last_reading && (
            <dd className="mt-1 text-xs text-muted">Waiting for the first reading.</dd>
          )}
        </div>

        <div>
          <dt className="text-xs text-muted">Monitoring</dt>
          <dd className={`font-medium ${pollingEnabled ? "" : "text-amber-700 dark:text-status-warning"}`}>
            {pollingEnabled ? "enabled" : "paused, incoming readings are discarded"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
