import type { VercelConfig } from "@vercel/config/v1";

/**
 * Vercel runs the scheduler tick. On the Hobby plan crons fire at most once a
 * day and at an hour Vercel picks, which serves the digest and the retention
 * job but not the stale-router alert; the GitHub Actions workflow in
 * .github/workflows/tick.yml covers that case on any plan.
 */
export const config: VercelConfig = {
  crons: [{ path: "/api/cron/tick", schedule: "*/5 * * * *" }],
};
