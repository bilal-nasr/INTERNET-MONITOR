import { describe, expect, test } from "vitest";
import {
  MAX_DEVICES_PER_PUSH,
  MAX_REPORTED_ERRORS,
  normaliseIp,
  normaliseMac,
  parseDevicePush,
} from "@/lib/devices/parse";

describe("normaliseMac", () => {
  test("accepts colon, dash and bare forms and upper-cases", () => {
    expect(normaliseMac("aa:bb:cc:dd:ee:ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normaliseMac("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normaliseMac("aabbccddeeff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normaliseMac("  AA:BB:CC:DD:EE:FF ")).toBe("AA:BB:CC:DD:EE:FF");
  });

  test("rejects anything that is not twelve hex digits", () => {
    expect(normaliseMac("aa:bb:cc:dd:ee")).toBeNull();
    expect(normaliseMac("zz:bb:cc:dd:ee:ff")).toBeNull();
    expect(normaliseMac("")).toBeNull();
  });
});

describe("normaliseIp", () => {
  test("passes IPv4 and IPv6 through and rejects everything else", () => {
    expect(normaliseIp("192.168.88.1")).toBe("192.168.88.1");
    expect(normaliseIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normaliseIp("999.1.1.1")).toBeNull();
    expect(normaliseIp("192.168.88.1; DROP")).toBeNull();
    expect(normaliseIp(null)).toBeNull();
    expect(normaliseIp("x".repeat(46))).toBeNull();
  });
});

describe("parseDevicePush", () => {
  const sample = { mac: "34:5a:60:70:a4:33", ip: "192.168.88.254", name: " bilal ", tx_bytes: 10, rx_bytes: "20" };

  test("accepts a well-formed push and normalises it", () => {
    const result = parseDevicePush({ router_time: "2026-09-12 11:48:49", devices: [sample] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.router_time).toBe("2026-09-12 11:48:49");
    expect(result.data.devices).toEqual([
      { mac: "34:5A:60:70:A4:33", ip: "192.168.88.254", name: "bilal", tx_bytes: 10, rx_bytes: 20 },
    ]);
  });

  test("blank name and missing ip become null", () => {
    const result = parseDevicePush({ devices: [{ ...sample, name: "   ", ip: undefined }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.devices[0].name).toBeNull();
    expect(result.data.devices[0].ip).toBeNull();
    expect(result.data.router_time).toBeNull();
  });

  test("trims names to 100 characters", () => {
    const result = parseDevicePush({ devices: [{ ...sample, name: "x".repeat(150) }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.devices[0].name).toHaveLength(100);
  });

  test("skips a bad entry, keeps the rest, and says which one went", () => {
    const result = parseDevicePush({ devices: [sample, { ...sample, mac: "nope" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.devices).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(Object.keys(result.errors)).toContain("devices.1.mac");
  });

  test("one unusable entry never costs the whole push", () => {
    const devices = [sample, { mac: "" }, { ...sample, mac: "aa:bb:cc:dd:ee:01" }, null];
    const result = parseDevicePush({ devices });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.devices.map((d) => d.mac)).toEqual(["34:5A:60:70:A4:33", "AA:BB:CC:DD:EE:01"]);
    expect(result.skipped).toBe(2);
  });

  test("a push with nothing usable in it is rejected", () => {
    const result = parseDevicePush({ devices: [{ mac: "nope" }, { mac: "also nope" }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toContain("devices.0.mac");
  });

  test("a flood of bad entries reports a bounded number of reasons", () => {
    const devices = Array.from({ length: 200 }, () => ({ mac: "nope" })).concat([sample as never]);
    const result = parseDevicePush({ devices });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBe(200);
    expect(Object.keys(result.errors).length).toBeLessThanOrEqual(MAX_REPORTED_ERRORS);
  });

  test("keeps only real IP addresses", () => {
    const cases = [
      ["192.168.88.254", "192.168.88.254"],
      ["  10.0.0.1  ", "10.0.0.1"],
      ["fe80::1", "fe80::1"],
      ["", null],
      ["not an ip", null],
      ["192.168.88.999", null],
      ["<script>", null],
    ] as const;
    for (const [given, expected] of cases) {
      const result = parseDevicePush({ devices: [{ ...sample, ip: given }] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.devices[0].ip).toBe(expected);
    }
  });

  test("rejects negative and non-integer counters", () => {
    expect(parseDevicePush({ devices: [{ ...sample, tx_bytes: -1 }] }).ok).toBe(false);
    expect(parseDevicePush({ devices: [{ ...sample, rx_bytes: 1.5 }] }).ok).toBe(false);
  });

  test("rejects more than the maximum number of devices", () => {
    const devices = Array.from({ length: MAX_DEVICES_PER_PUSH + 1 }, () => sample);
    expect(parseDevicePush({ devices }).ok).toBe(false);
  });

  test("rejects an empty list and a missing list", () => {
    expect(parseDevicePush({ devices: [] }).ok).toBe(false);
    expect(parseDevicePush({}).ok).toBe(false);
  });

  test("keeps the last sample when a mac repeats inside one push", () => {
    const result = parseDevicePush({ devices: [sample, { ...sample, tx_bytes: 99 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.devices).toHaveLength(1);
    expect(result.data.devices[0].tx_bytes).toBe(99);
  });
});
