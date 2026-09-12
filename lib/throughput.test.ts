import { describe, expect, test } from "vitest";
import { ratesFromReadings } from "@/lib/throughput";
import type { Reading } from "@/lib/usage";

function reading(id: number, iso: string, tx: number, rx: number, iface = "pppoe-out1"): Reading {
  return {
    id,
    recorded_at: new Date(iso),
    tx_bytes: tx,
    rx_bytes: rx,
    total_bytes: tx + rx,
    interface_name: iface,
  };
}

describe("ratesFromReadings", () => {
  test("divides each counter's growth by the seconds between readings", () => {
    const rates = ratesFromReadings([
      reading(1, "2026-09-12T10:00:00Z", 1_000, 10_000),
      reading(2, "2026-09-12T10:00:30Z", 1_300, 40_000),
      reading(3, "2026-09-12T10:01:00Z", 1_300, 100_000),
    ]);
    expect(rates).toEqual([
      {
        at: "2026-09-12T10:00:30.000Z",
        seconds: 30,
        bytes_per_second: 1010,
        tx_per_second: 10,
        rx_per_second: 1000,
      },
      {
        at: "2026-09-12T10:01:00.000Z",
        seconds: 30,
        bytes_per_second: 2000,
        tx_per_second: 0,
        rx_per_second: 2000,
      },
    ]);
  });

  test("skips the pair around a counter reset instead of inventing a rate", () => {
    const rates = ratesFromReadings([
      reading(1, "2026-09-12T10:00:00Z", 5_000, 90_000),
      reading(2, "2026-09-12T10:00:30Z", 100, 200), // interface restarted
      reading(3, "2026-09-12T10:01:00Z", 400, 3_200),
    ]);
    expect(rates).toEqual([
      {
        at: "2026-09-12T10:01:00.000Z",
        seconds: 30,
        bytes_per_second: 110,
        tx_per_second: 10,
        rx_per_second: 100,
      },
    ]);
  });

  test("skips a pair that straddles a change of interface", () => {
    // Two interfaces are unrelated counter streams. Chaining them reads as a
    // single enormous transfer over half a minute, which is what the dashboard
    // would then headline as the live throughput.
    const rates = ratesFromReadings([
      reading(1, "2026-09-12T10:00:00Z", 1_000, 10_000, "pppoe-out1"),
      reading(2, "2026-09-12T10:00:30Z", 9e9, 9e9, "ether1"),
      reading(3, "2026-09-12T10:01:00Z", 9e9 + 300, 9e9 + 3_000, "ether1"),
    ]);
    expect(rates).toEqual([
      {
        at: "2026-09-12T10:01:00.000Z",
        seconds: 30,
        bytes_per_second: 110,
        tx_per_second: 10,
        rx_per_second: 100,
      },
    ]);
  });

  test("skips a gap longer than the limit, since it is an outage not an interval", () => {
    const rates = ratesFromReadings(
      [
        reading(1, "2026-09-12T10:00:00Z", 0, 0),
        reading(2, "2026-09-12T10:10:00Z", 0, 600_000), // 10 minutes
        reading(3, "2026-09-12T10:10:30Z", 0, 630_000),
      ],
      300,
    );
    expect(rates.map((r) => r.at)).toEqual(["2026-09-12T10:10:30.000Z"]);
    expect(rates[0].rx_per_second).toBe(1000);
  });

  test("a single reading, or none, gives no rate", () => {
    expect(ratesFromReadings([])).toEqual([]);
    expect(ratesFromReadings([reading(1, "2026-09-12T10:00:00Z", 1, 1)])).toEqual([]);
  });

  test("ignores a duplicate timestamp rather than dividing by zero", () => {
    const rates = ratesFromReadings([
      reading(1, "2026-09-12T10:00:00Z", 0, 0),
      reading(2, "2026-09-12T10:00:00Z", 0, 500),
      reading(3, "2026-09-12T10:00:10Z", 0, 1_500),
    ]);
    expect(rates).toEqual([
      {
        at: "2026-09-12T10:00:10.000Z",
        seconds: 10,
        bytes_per_second: 100,
        tx_per_second: 0,
        rx_per_second: 100,
      },
    ]);
  });

  test("each point says how long it covers, so a caller can see the skipped intervals", () => {
    // The pair around the reset is dropped, so the point after it covers only
    // its own 30 seconds while sitting a minute after the point before it.
    const rates = ratesFromReadings([
      reading(1, "2026-09-12T10:00:00Z", 0, 1_000),
      reading(2, "2026-09-12T10:00:30Z", 0, 4_000),
      reading(3, "2026-09-12T10:01:00Z", 0, 10), // reset
      reading(4, "2026-09-12T10:01:30Z", 0, 3_010),
    ]);
    expect(rates.map((r) => [r.at, r.seconds])).toEqual([
      ["2026-09-12T10:00:30.000Z", 30],
      ["2026-09-12T10:01:30.000Z", 30],
    ]);
  });
});
