import Link from "next/link";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SessionsTable, SessionTotalsCards } from "@/components/SessionsTable";
import { getSessions, getSessionTotals } from "@/lib/sessions";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Sessions - MikroTik Quota Monitor" };

const RANGES = [7, 30, 90] as const;

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await connection();

  const { days: rawDays } = await searchParams;
  const parsed = Number(rawDays);
  const days = Number.isInteger(parsed) && parsed > 0 && parsed <= 3650 ? parsed : 30;

  let timezone = "UTC";
  try {
    timezone = (await getSettings()).timezone;
  } catch {
    // Settings unavailable: fall back to UTC so the page still renders.
  }

  const [sessions, totals] = await Promise.all([getSessions(days, 200), getSessionTotals(days)]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Link sessions</h1>
          <p className="text-sm text-muted">
            Every WAN connection the router reported, with its uptime and traffic. Times in {timezone}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AutoRefresh seconds={20} />
          <nav className="flex gap-1 text-sm">
            {RANGES.map((r) => (
              <Link
              key={r}
              href={`/sessions?days=${r}`}
              aria-current={r === days ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                r === days ? "bg-foreground text-background" : "text-muted hover:bg-border/60 hover:text-foreground"
              }`}
            >
              {r} days
            </Link>
            ))}
          </nav>
        </div>
      </div>

      <SessionTotalsCards totals={totals} />

      <SessionsTable sessions={sessions} timezone={timezone} />

      <p className="text-xs text-muted">
        Totals are the sum of each session&apos;s own counters, so a reconnect never loses or double-counts
        traffic. Traffic between the last sample and an unexpected drop cannot be recovered, so a session can
        under-report by up to one polling interval.
      </p>
    </div>
  );
}
