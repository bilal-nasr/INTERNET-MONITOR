import { CopyButton } from "@/components/CopyButton";
import { MeterDisc } from "@/components/meter/MeterDisc";
import { MeterWindow } from "@/components/meter/MeterWindow";
import { Stamp } from "@/components/meter/Stamp";
import { formatBytes, formatRate } from "@/lib/format";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { reachability, type RouterAddress } from "@/lib/router/address";
import type { SessionSummary } from "@/lib/sessions";
import type { RatePoint } from "@/lib/throughput";
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
  address,
  rate,
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
  /**
   * The router's addresses. Left out (undefined) on the share page, which must
   * not hand the home's address to whoever holds the link; null when the
   * router has not reported one yet.
   */
  address?: RouterAddress | null;
  /**
   * The newest measured rate, which turns the meter disc. Left out (undefined)
   * where no rates were read; null when none was measured recently.
   */
  rate?: RatePoint | null;
}) {
  const { d, f } = await getI18n();
  const state = linkState(session, staleAfterMinutes > 0 ? staleAfterMinutes * 60 : SILENT_AFTER_SECONDS);
  const ageMinutes = usage.last_reading
    ? Math.round(
        (new Date(usage.generated_at).getTime() - new Date(usage.last_reading.recorded_at).getTime()) / 60_000,
      )
    : null;
  // The disc only turns for a line that is up; a dropped or silent link has no
  // live rate to show, whatever the last measured one was.
  const liveRate = state.kind === "up" && rate ? rate : null;

  return (
    <MeterWindow label={d.router.link} aside={<span dir="ltr">{interfaceName}</span>}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          {state.kind === "up" && (
            <>
              <p className="text-lg font-semibold leading-snug">
                {fill(d.router.upFor, { duration: f.duration(state.session.uptime_seconds) })}
              </p>
              <p className="text-xs tabular-nums text-muted">
                {fill(d.router.sinceTime, {
                  bytes: formatBytes(state.session.total_bytes),
                  time: f.stamp(state.session.started_at, usage.timezone),
                })}
              </p>
            </>
          )}
          {state.kind === "down" && (
            <>
              <p className="text-lg font-semibold leading-snug text-status-critical">
                {fill(d.router.downSince, { time: f.stamp(state.session.ended_at!, usage.timezone) })}
              </p>
              <p className="text-xs text-muted">
                {fill(d.router.downExplanation, { duration: f.duration(state.session.seconds_since_seen) })}
              </p>
            </>
          )}
          {state.kind === "silent" && (
            <>
              <p className="text-lg font-semibold leading-snug text-status-critical">{d.router.noContact}</p>
              <p className="text-xs text-muted">
                {fill(d.router.noContactExplanation, { duration: f.duration(state.session.seconds_since_seen) })}
              </p>
              <p className="text-xs text-muted">{d.router.causeAfterReconnect}</p>
              {staleAlertAt &&
                usage.last_reading &&
                new Date(staleAlertAt) > new Date(usage.last_reading.recorded_at) && (
                  <p className="text-xs text-muted">
                    {fill(d.router.staleAlertSent, { time: f.stamp(staleAlertAt, usage.timezone) })}
                  </p>
                )}
            </>
          )}
          {state.kind === "unknown" && <p className="text-lg font-semibold text-muted">{d.router.noSessionYet}</p>}
        </div>
        <LinkStamp kind={state.kind} />
      </div>

      {rate !== undefined && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted">{d.router.rateNow}</span>
            <span className="text-base font-semibold tabular-nums">
              {liveRate ? formatRate(liveRate.bytes_per_second) : "-"}
            </span>
          </div>
          <MeterDisc bytesPerSecond={liveRate ? liveRate.bytes_per_second : null} className="mt-1.5 w-full" />
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-series-1" />
              <dt className="text-muted">{d.common.download}</dt>
              <dd className="tabular-nums">{liveRate ? formatRate(liveRate.rx_per_second) : "-"}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-series-2" />
              <dt className="text-muted">{d.common.upload}</dt>
              <dd className="tabular-nums">{liveRate ? formatRate(liveRate.tx_per_second) : "-"}</dd>
            </div>
          </dl>
        </div>
      )}

      <div className="mt-auto pt-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 text-xs">
          <div>
            <dt className="text-muted">{d.router.lastReading}</dt>
            {/* Flex, so the gap sits between the two runs whichever way the line
                runs; a margin would have to pick a side and bidi decides which
                side is which. */}
            <dd className="flex flex-wrap items-baseline gap-x-2">
              <span>
                {usage.last_reading ? f.stamp(usage.last_reading.recorded_at, usage.timezone) : d.common.never}
              </span>
              {ageMinutes !== null && (
                <span className="text-muted">
                  {ageMinutes < 1 ? d.common.justNow : fill(d.common.minutesAgo, { minutes: ageMinutes })}
                </span>
              )}
            </dd>
            {usage.last_reading && (
              <dd className="text-muted">
                {fill(d.router.txRx, {
                  tx: formatBytes(usage.last_reading.tx_bytes),
                  rx: formatBytes(usage.last_reading.rx_bytes),
                })}
              </dd>
            )}
            {pollingEnabled && !usage.last_reading && <dd className="text-muted">{d.router.waitingFirstReading}</dd>}
          </div>

          <div>
            <dt className="text-muted">{d.router.monitoring}</dt>
            <dd className={pollingEnabled ? "" : "text-amber-700 dark:text-status-warning"}>
              {pollingEnabled ? d.router.monitoringEnabled : d.router.monitoringPaused}
            </dd>
          </div>

          {address !== undefined && <AddressRow address={address} timezone={usage.timezone} />}
        </dl>
      </div>
    </MeterWindow>
  );
}

async function LinkStamp({ kind }: { kind: LinkState["kind"] }) {
  const { d } = await getI18n();
  if (kind === "up") return <Stamp tone="good">{d.router.stampUp}</Stamp>;
  if (kind === "down") return <Stamp tone="critical">{d.router.stampDown}</Stamp>;
  if (kind === "silent") return <Stamp tone="critical">{d.router.stampSilent}</Stamp>;
  return <Stamp tone="neutral">{d.router.stampUnknown}</Stamp>;
}

async function AddressRow({ address, timezone }: { address: RouterAddress | null; timezone: string }) {
  const { d, f } = await getI18n();
  const shown = address?.public_ip ?? address?.wan_ip ?? null;
  if (!address || !shown) {
    return (
      <div className="col-span-2">
        <dt className="text-muted">{d.router.address}</dt>
        <dd className="text-muted">{d.router.addressPending}</dd>
      </div>
    );
  }
  const reach = reachability(address.wan_ip, address.public_ip);
  return (
    <div className="col-span-2">
      <dt className="text-muted">{d.router.address}</dt>
      <dd className="flex flex-wrap items-center gap-2">
        {/* An address reads left to right in either language. */}
        <span dir="ltr" className="text-sm font-medium tabular-nums">
          {shown}
        </span>
        <CopyButton
          text={shown}
          label={d.router.copyIp}
          copiedLabel={d.router.copiedIp}
          failedLabel={d.router.copyIpFailed}
          compact
        />
      </dd>
      {address.wan_ip && address.wan_ip !== shown && (
        <dd className="text-muted">
          {fill(d.router.addressWan, { ip: address.wan_ip })}
        </dd>
      )}
      <dd className="text-muted">
        {fill(d.router.addressSince, { time: f.stamp(address.changed_at, timezone) })}
      </dd>
      {reach === "public" && <dd className="text-muted">{d.router.addressPublic}</dd>}
      {reach === "cgnat" && (
        <dd className="text-amber-700 dark:text-status-warning">{d.router.addressCgnat}</dd>
      )}
      {reach === "nat" && (
        <dd className="text-amber-700 dark:text-status-warning">{d.router.addressNat}</dd>
      )}
    </div>
  );
}
