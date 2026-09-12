/**
 * The body the router's devices-push script sends, checked and normalised.
 *
 * Pure, so the shape rules are testable without a database. MACs are stored in
 * one canonical form because they are the primary key of `devices`: the same
 * phone must never become two rows because RouterOS printed it with dashes
 * one day and colons the next.
 *
 * One bad entry never costs the rest. A DHCP host-name is whatever the device
 * announced -- it is not the router's text and not the owner's -- so a single
 * oddly named device must not be able to stop per-device collection for the
 * whole LAN. Entries that fail are dropped and counted; the push goes through
 * with the ones that passed, and only a push with nothing usable in it at all
 * is rejected.
 */

import { z } from "zod";

export const MAX_DEVICES_PER_PUSH = 500;

/** Entries whose reasons are reported back; the rest are only counted. */
export const MAX_REPORTED_ERRORS = 20;

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
  | {
      ok: true;
      data: DevicePush;
      /** Entries dropped for being malformed. */
      skipped: number;
      /** Why, for at most MAX_REPORTED_ERRORS of them, keyed by position. */
      errors: Record<string, string[]>;
    }
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

const address = z.union([z.ipv4(), z.ipv6()]);

/**
 * The address as an address, not as text. RouterOS sends an empty string when
 * it has no lease for the device, and anything it cannot print becomes a null
 * rather than a rejected entry: the device's counters are the point of the
 * push, and the previous address is kept by the upsert's COALESCE.
 */
export function normaliseIp(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed.length > 45) return null;
  return address.safeParse(trimmed).success ? trimmed : null;
}

const sampleSchema = z.object({
  mac: z.string().transform((v, ctx) => {
    const mac = normaliseMac(v);
    if (!mac) {
      ctx.addIssue({ code: "custom", message: "not a MAC address" });
      return z.NEVER;
    }
    return mac;
  }),
  ip: z
    .string()
    .optional()
    .nullable()
    .transform((v) => normaliseIp(v)),
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

/** The push around the entries. The entries themselves are checked one by one. */
const envelopeSchema = z.object({
  router_time: optionalText(100),
  devices: z.array(z.unknown()).min(1).max(MAX_DEVICES_PER_PUSH),
});

function addIssues(
  errors: Record<string, string[]>,
  issues: readonly { path: PropertyKey[]; message: string }[],
  prefix: (string | number)[] = [],
): void {
  for (const issue of issues) {
    if (Object.keys(errors).length >= MAX_REPORTED_ERRORS) return;
    const key = [...prefix, ...issue.path].join(".") || "_";
    (errors[key] ??= []).push(issue.message);
  }
}

export function parseDevicePush(body: unknown): ParseResult {
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) {
    const errors: Record<string, string[]> = {};
    addIssues(errors, envelope.error.issues);
    return { ok: false, errors };
  }

  const errors: Record<string, string[]> = {};
  let skipped = 0;
  // A MAC listed twice in one push is one device: the later sample wins, being
  // the newer counter value.
  const byMac = new Map<string, DeviceSample>();

  envelope.data.devices.forEach((raw, index) => {
    const parsed = sampleSchema.safeParse(raw);
    if (!parsed.success) {
      skipped += 1;
      addIssues(errors, parsed.error.issues, ["devices", index]);
      return;
    }
    byMac.set(parsed.data.mac, parsed.data);
  });

  if (byMac.size === 0) return { ok: false, errors };
  return {
    ok: true,
    data: { router_time: envelope.data.router_time, devices: [...byMac.values()] },
    skipped,
    errors,
  };
}
