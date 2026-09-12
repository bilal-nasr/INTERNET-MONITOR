import type { VercelConfig } from "@vercel/config/v1";

/**
 * Vercel runs the scheduler tick once a day. The Hobby plan rejects any cron
 * that fires more often, and runs a daily one somewhere inside the given hour.
 * 06:00 UTC lands between 08:00 and 09:59 in Beirut (UTC+2/+3), so the tick is
 * always after the 08:00 digest boundary. That serves the digest and the
 * retention job but not the stale-router alert; the GitHub Actions workflow in
 * .github/workflows/tick.yml runs every five minutes and covers that case.
 */
export const config: VercelConfig = {
  crons: [{ path: "/api/cron/tick", schedule: "0 6 * * *" }],
};
