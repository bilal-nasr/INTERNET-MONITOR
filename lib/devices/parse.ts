/**
 * The body the router's devices-push script sends, checked and normalised.
 *
 * Pure, so the shape rules are testable without a database. MACs are stored in
 * one canonical form because they are the primary key of `devices`: the same
 * phone must never become two rows because RouterOS printed it with dashes
 * one day and colons the next.
 */

import { z } from "zod";

export const MAX_DEVICES_PER_PUSH = 500;

export interface DeviceSample {
  mac: string;
  ip: string | null;
  name: string | null;
  tx_bytes: number;
  rx_bytes: number;
}

export interface DevicePush {
  router_time: string | null;
  devices: DeviceSample[];
}

export type ParseResult =
  | { ok: true; data: DevicePush }
  | { ok: false; errors: Record<string, string[]> };

/** "AA:BB:CC:DD:EE:FF" from any of the usual spellings, or null when it is not a MAC. */
export function normaliseMac(raw: string): string | null {
  const hex = raw.trim().replace(/[:\-.]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex)) return null;
  return hex.match(/.{2}/g)!.join(":");
}

const counter = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const sampleSchema = z.object({
  mac: z.string().transform((v, ctx) => {
    const mac = normaliseMac(v);
    if (!mac) {
      ctx.addIssue({ code: "custom", message: "not a MAC address" });
      return z.NEVER;
    }
    return mac;
  }),
  ip: optionalText(45),
  name: z
    .string()
    .optional()
    .nullable()
    .transform((v) => {
      const trimmed = (v ?? "").trim().slice(0, 100);
      return trimmed ? trimmed : null;
    }),
  tx_bytes: counter,
  rx_bytes: counter,
});

const pushSchema = z.object({
  router_time: optionalText(100),
  devices: z.array(sampleSchema).min(1).max(MAX_DEVICES_PER_PUSH),
});

export function parseDevicePush(body: unknown): ParseResult {
  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "_";
      (errors[key] ??= []).push(issue.message);
    }
    return { ok: false, errors };
  }
  // A MAC listed twice in one push is one device: the later sample wins, being
  // the newer counter value.
  const byMac = new Map<string, DeviceSample>();
  for (const device of parsed.data.devices) byMac.set(device.mac, device);
  return {
    ok: true,
    data: { router_time: parsed.data.router_time, devices: [...byMac.values()] },
  };
}
