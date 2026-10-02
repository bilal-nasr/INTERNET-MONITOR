import { isIP } from "node:net";

/**
 * The router's addresses, as the dashboard shows them. The router reports the
 * address on its WAN interface; the app sees the address its push arrived
 * from. When the two match the router holds a public address; when they differ
 * something in between (normally the ISP's carrier-grade NAT) is translating,
 * and nothing outside can open a connection to the router at either address.
 */

export interface RouterAddress {
  /** Address on the WAN interface, as the router reports it. Null from an old script or with the link down. */
  wan_ip: string | null;
  /** Address the push arrived from, as the hosting proxy reports it. Null when no proxy header is set. */
  public_ip: string | null;
  /** When either address last changed, ISO. */
  changed_at: string;
  /** The last push that reported them, ISO. */
  seen_at: string;
}

export type Reachability = "public" | "cgnat" | "nat" | "unknown";

/** A bare IPv4 or IPv6 address, or null. Accepts "a.b.c.d/32" since that is how RouterOS prints one. */
export function cleanIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const bare = value.trim().replace(/\/\d{1,3}$/, "");
  return bare.length <= 45 && isIP(bare) ? bare : null;
}

/**
 * The client's address from the proxy in front of the app. Vercel sets
 * x-real-ip and overwrites x-forwarded-for, so neither can be forged there;
 * a self-hosted install without a proxy has neither, and gets null rather than
 * an address it cannot trust.
 */
export function clientIpFromRequest(request: Request): string | null {
  const real = cleanIp(request.headers.get("x-real-ip"));
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? cleanIp(forwarded.split(",")[0]) : null;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inRange(ip: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((ipv4ToInt(base)! & mask) >>> 0);
}

/** RFC 6598 shared address space, the range ISPs number CGNAT customers from. */
export function isCarrierNat(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return n !== null && inRange(n, "100.64.0.0", 10);
}

/** RFC 1918 private ranges. */
export function isPrivate(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return n !== null && (inRange(n, "10.0.0.0", 8) || inRange(n, "172.16.0.0", 12) || inRange(n, "192.168.0.0", 16));
}

/**
 * Whether a connection from outside could reach the router. "public" only says
 * the address is the router's own; the router's firewall still decides what
 * it answers.
 */
export function reachability(wanIp: string | null, publicIp: string | null): Reachability {
  if (wanIp && isCarrierNat(wanIp)) return "cgnat";
  if (wanIp && isPrivate(wanIp)) return "nat";
  if (wanIp && publicIp) return wanIp === publicIp ? "public" : "nat";
  return "unknown";
}
