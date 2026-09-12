/**
 * What the router should do with the LAN, decided from the quota state the
 * push just produced. Pure, so the settings page and the ingest route agree.
 *
 * The daily quota only governs traffic inside its window, so a breach earlier
 * in the day stops mattering once the window closes. The monthly cap counts
 * every hour, so it applies at any time. When both apply the daily one is
 * named: it is the one the alert email cites and the one that clears first.
 */
export interface PolicyInput {
  throttleOnBreach: boolean;
  throttleOnCap: boolean;
  windowActive: boolean;
  dailyExceeded: boolean;
  capExceeded: boolean;
}

export type PolicyReason = "daily_quota" | "monthly_cap";

export interface Policy {
  throttle: boolean;
  reason: PolicyReason | null;
}

export function decidePolicy(input: PolicyInput): Policy {
  if (input.throttleOnBreach && input.windowActive && input.dailyExceeded) {
    return { throttle: true, reason: "daily_quota" };
  }
  if (input.throttleOnCap && input.capExceeded) {
    return { throttle: true, reason: "monthly_cap" };
  }
  return { throttle: false, reason: null };
}
