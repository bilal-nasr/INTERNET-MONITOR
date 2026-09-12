import { z } from "zod";
import type { RouterEvidence } from "@/lib/outage-cause";

/**
 * The outage evidence fields of the router's push, as zod sees them. Kept apart
 * from lib/outage-cause.ts so the client components that label outages do not
 * pull zod into the browser bundle.
 */

/** RouterOS sends an unset global as an empty string. */
const blank = (value: unknown) => (value === "" || value === null ? undefined : value);

// Every field falls back instead of failing: the reading in the same push is
// the one fact that cannot be rebuilt, and a malformed diagnostic must never
// cost it a 400.
// z.coerce.number() would turn " ", false, and [] into 0; accept only an
// actual non-negative integer or a string of digits.
const seconds = z
  .preprocess(
    blank,
    z
      .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/).transform(Number)])
      .pipe(z.number().max(1e10))
      .optional(),
  )
  .catch(undefined);
const flag = z
  .preprocess(blank, z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]).optional())
  .catch(undefined);

/** Spread into the ingest body schema. All optional: an old script sends none of them. */
export const evidenceBodyFields = {
  uptime_s: seconds,
  ether_running: flag,
  ether_link_downs: seconds,
  pppoe_link_downs: seconds,
  netwatch: z.preprocess(blank, z.enum(["up", "down", "unknown"]).optional()).catch("unknown"),
  planned_reconnects: seconds,
  push_failures: seconds,
  eth_down_at: seconds,
  eth_up_at: seconds,
  ppp_down_at: seconds,
  ppp_up_at: seconds,
  net_down_at: seconds,
  net_up_at: seconds,
};

export const evidenceBodySchema = z.object(evidenceBodyFields);

export type EvidenceBody = z.infer<typeof evidenceBodySchema>;

export function evidenceFromBody(body: EvidenceBody, pppoeRunning: boolean): RouterEvidence {
  return {
    uptime_s: body.uptime_s ?? null,
    ether_running: body.ether_running ?? null,
    ether_link_downs: body.ether_link_downs ?? null,
    pppoe_running: pppoeRunning,
    pppoe_link_downs: body.pppoe_link_downs ?? null,
    netwatch: body.netwatch ?? "unknown",
    planned_reconnects: body.planned_reconnects ?? null,
    push_failures: body.push_failures ?? null,
    eth_down_at: body.eth_down_at ?? null,
    eth_up_at: body.eth_up_at ?? null,
    ppp_down_at: body.ppp_down_at ?? null,
    ppp_up_at: body.ppp_up_at ?? null,
    net_down_at: body.net_down_at ?? null,
    net_up_at: body.net_up_at ?? null,
  };
}
