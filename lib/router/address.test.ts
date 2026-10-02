import { describe, expect, test } from "vitest";
import { cleanIp, clientIpFromRequest, isCarrierNat, isPrivate, reachability } from "@/lib/router/address";

describe("cleanIp", () => {
  test("strips the prefix length RouterOS prints", () => {
    expect(cleanIp("100.107.154.46/32")).toBe("100.107.154.46");
  });

  test("accepts IPv6", () => {
    expect(cleanIp("2001:db8::1")).toBe("2001:db8::1");
  });

  test("rejects anything that is not an address", () => {
    expect(cleanIp("")).toBeNull();
    expect(cleanIp("not an ip")).toBeNull();
    expect(cleanIp("300.1.1.1")).toBeNull();
    expect(cleanIp(undefined)).toBeNull();
    expect(cleanIp(42)).toBeNull();
  });
});

describe("clientIpFromRequest", () => {
  const req = (headers: Record<string, string>) => new Request("http://x/api/ingest", { headers });

  test("prefers x-real-ip", () => {
    expect(clientIpFromRequest(req({ "x-real-ip": "5.57.6.202", "x-forwarded-for": "1.2.3.4" }))).toBe("5.57.6.202");
  });

  test("falls back to the first x-forwarded-for entry", () => {
    expect(clientIpFromRequest(req({ "x-forwarded-for": "5.57.6.202, 10.0.0.1" }))).toBe("5.57.6.202");
  });

  test("is null without a proxy header", () => {
    expect(clientIpFromRequest(req({}))).toBeNull();
  });
});

describe("ranges", () => {
  test("100.64.0.0/10 is carrier NAT, its neighbours are not", () => {
    expect(isCarrierNat("100.107.154.46")).toBe(true);
    expect(isCarrierNat("100.64.0.0")).toBe(true);
    expect(isCarrierNat("100.127.255.255")).toBe(true);
    expect(isCarrierNat("100.128.0.0")).toBe(false);
    expect(isCarrierNat("100.63.255.255")).toBe(false);
  });

  test("RFC 1918 ranges are private", () => {
    expect(isPrivate("10.1.2.3")).toBe(true);
    expect(isPrivate("172.31.0.1")).toBe(true);
    expect(isPrivate("172.32.0.1")).toBe(false);
    expect(isPrivate("192.168.1.1")).toBe(true);
    expect(isPrivate("5.57.6.202")).toBe(false);
  });
});

describe("reachability", () => {
  test("a carrier NAT WAN address is cgnat whatever the public one", () => {
    expect(reachability("100.107.154.46", "5.57.6.202")).toBe("cgnat");
  });

  test("a private WAN address is behind NAT", () => {
    expect(reachability("192.168.1.10", "5.57.6.202")).toBe("nat");
  });

  test("matching addresses are public", () => {
    expect(reachability("5.57.6.202", "5.57.6.202")).toBe("public");
  });

  test("a public WAN address that differs from the seen one is NAT", () => {
    expect(reachability("5.57.6.202", "5.57.6.9")).toBe("nat");
  });

  test("not enough to tell", () => {
    expect(reachability(null, "5.57.6.202")).toBe("unknown");
    expect(reachability("5.57.6.202", null)).toBe("unknown");
  });
});
