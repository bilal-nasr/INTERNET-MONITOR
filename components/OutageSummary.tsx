import { StatTiles, type Tile } from "@/components/stats/chrome";
import { fill, plural } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { Outage } from "@/lib/outages";

/**
 * Three figures for the range: how long the link was down in total, the
 * single longest outage, and how many there were. Availability already has
 * a tile on the statistics page, so it is not repeated here.
 */
export async function OutageSummary({
  outages,
  rangeSeconds,
  timezone,
}: {
  outages: Outage[];
  /** Length of the range being shown, for the share figure; null for all time. */
  rangeSeconds: number | null;
  timezone: string;
}) {
  const { locale, d, f } = await getI18n();
  const s = d.sessions;

  const total = outages.reduce((sum, o) => sum + o.seconds, 0);
  const longest = outages.reduce<Outage | null>(
    (best, o) => (best && best.seconds >= o.seconds ? best : o),
    null,
  );
  const share = rangeSeconds && rangeSeconds > 0 ? (total / rangeSeconds) * 100 : null;

  const tiles: Tile[] = [
    {
      label: s.totalDowntime,
      value: f.duration(total),
      hint:
        share !== null
          ? fill(s.downtimeShare, { percent: share.toFixed(share >= 10 ? 0 : 1) })
          : undefined,
      tone: total === 0 ? "good" : share !== null && share >= 5 ? "critical" : "warning",
    },
    {
      label: s.longestOutage,
      value: longest ? f.duration(longest.seconds) : d.common.empty,
      hint: longest
        ? longest.next_session_id === null
          ? s.outageOngoing
          : fill(s.outageEndedAt, { time: f.stamp(longest.to, timezone) })
        : s.noOutages,
    },
    {
      label: s.downtimeHeading,
      value: plural(locale, s.outagesCount, outages.length),
      hint: s.outagesHint,
    },
  ];

  return <StatTiles tiles={tiles} columns={3} />;
}
