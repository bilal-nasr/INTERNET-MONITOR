/**
 * The dashboard's headline figures as Prometheus text exposition (0.0.4).
 *
 * Pure: it turns one sample into text. Everything is a gauge, since every
 * figure is a level rather than a count that only grows. A null is a figure
 * the deployment cannot state right now (no session yet, no reading yet) and
 * is omitted rather than written as 0, which would be a claim.
 */

export interface MetricsSample {
  today_used_bytes: number;
  today_quota_bytes: number;
  today_percent: number;
  window_active: boolean;
  cycle_used_bytes: number;
  cycle_cap_bytes: number;
  cycle_percent: number;
  last_reading_age_seconds: number | null;
  link_up: boolean | null;
  session_uptime_seconds: number | null;
  polling_enabled: boolean;
}

const PREFIX = "quota_monitor_";

const HELP: Record<keyof MetricsSample, string> = {
  today_used_bytes: "Traffic inside today's quota window in bytes",
  today_quota_bytes: "Daily quota in bytes",
  today_percent: "Today's usage as a percentage of the daily quota",
  window_active: "1 while the local time is inside the quota window",
  cycle_used_bytes: "Traffic this billing cycle in bytes",
  cycle_cap_bytes: "Monthly cap in bytes",
  cycle_percent: "This cycle's usage as a percentage of the cap",
  last_reading_age_seconds: "Seconds since the router last pushed a reading",
  link_up: "1 while the WAN link is up and the router is reporting",
  session_uptime_seconds: "Seconds the current WAN session has been up",
  polling_enabled: "1 while incoming readings are being stored",
};

function asNumber(value: number | boolean): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  return Number.isFinite(value) ? String(value) : "0";
}

export function renderPrometheus(sample: MetricsSample): string {
  const lines: string[] = [];
  for (const key of Object.keys(HELP) as (keyof MetricsSample)[]) {
    const value = sample[key];
    if (value === null || value === undefined) continue;
    const name = PREFIX + key;
    lines.push(`# HELP ${name} ${HELP[key]}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${asNumber(value)}`);
  }
  return lines.join("\n") + "\n";
}
