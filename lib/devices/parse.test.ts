import { describe, expect, test } from "vitest";
import { MAX_DEVICES_PER_PUSH, normaliseMac, parseDevicePush } from "@/lib/devices/parse";

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

  test("rejects a bad mac with the index in the error key", () => {
    const result = parseDevicePush({ devices: [sample, { ...sample, mac: "nope" }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toContain("devices.1.mac");
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
