import { StatTiles, type Tile } from "@/components/stats/chrome";
import { fill, plural } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { describeSplit, downtimeSplit, type Outage, type OutageWithCauses } from "@/lib/outages";

/**
 * Three figures for the range: how long the link was down in total, the
 * single longest outage, and how many there were. Availability already has
 * a tile on the statistics page, so it is not repeated here.
 */
export async function OutageSummary({
  outages,
  betweenSessionsSeconds,
  rangeSeconds,
  timezone,
}: {
  outages: OutageWithCauses[];
  /**
   * Downtime between sessions over the range, counted in the database. The same
   * figure the "offline" hint on the totals cards above is drawn from, so the
   * two cannot disagree.
   */
  betweenSessionsSeconds: number;
  /** Length of the range being shown, for the share figure; null for all time. */
  rangeSeconds: number | null;
  timezone: string;
}) {
  const { locale, d, f } = await getI18n();
  const s = d.sessions;

  // One definition of downtime for the whole page. The database counts every
  // gap between two sessions, including the ones past the row limit this list
  // is truncated at; what it cannot see is a link that has not come back, which
  // has no following session and therefore no gap. That trailing stretch is
  // added here as its own term and named in the hint, so the figure beside it
  // is this one minus something the reader can see.
  const ongoing = outages.find((o) => o.next_session_id === null) ?? null;
  const total = betweenSessionsSeconds + (ongoing?.seconds ?? 0);
  const longest = outages.reduce<Outage | null>(
    (best, o) => (best && best.seconds >= o.seconds ? best : o),
    null,
  );
  const share = rangeSeconds && rangeSeconds > 0 ? (total / rangeSeconds) * 100 : null;

  const hints = [
    share !== null ? fill(s.downtimeShare, { percent: share.toFixed(share >= 10 ? 0 : 1) }) : null,
    ongoing ? fill(s.includingStillDown, { duration: f.duration(ongoing.seconds) }) : null,
    // Whose side the listed outages were on, from the router's own evidence.
    ...describeSplit(downtimeSplit(outages), s, f.duration),
  ].filter((part): part is string => part !== null);

  const tiles: Tile[] = [
    {
      label: s.totalDowntime,
      value: f.duration(total),
      hint: hints.length > 0 ? hints.join(" · ") : undefined,
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
      label: s.outagesLabel,
      value: plural(locale, s.outagesCount, outages.length),
      hint: s.outagesHint,
    },
  ];

  return <StatTiles tiles={tiles} columns={3} />;
}
