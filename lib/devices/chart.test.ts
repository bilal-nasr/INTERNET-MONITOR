import { describe, expect, test } from "vitest";
import { OTHERS_KEY, stackDeviceSeries } from "@/lib/devices/chart";
import type { DeviceSeriesPoint } from "@/lib/devices/usage";

function point(mac: string, bucket: string, total: number): DeviceSeriesPoint {
  return { mac, bucket, total_bytes: total, tx_bytes: 0, rx_bytes: total, readings: 1 };
}

describe("stackDeviceSeries", () => {
  test("one row per bucket, one GB column per top device, zero where absent", () => {
    const rows = stackDeviceSeries(
      [
        point("A", "2026-09-01T00:00:00", 2e9),
        point("B", "2026-09-01T00:00:00", 1e9),
        point("A", "2026-09-02T00:00:00", 5e8),
      ],
      ["A", "B"],
    );
    expect(rows).toEqual([
      { bucket: "2026-09-01T00:00:00", A: 2, B: 1, [OTHERS_KEY]: 0 },
      { bucket: "2026-09-02T00:00:00", A: 0.5, B: 0, [OTHERS_KEY]: 0 },
    ]);
  });

  test("devices outside the top list are summed into Others", () => {
    const rows = stackDeviceSeries(
      [
        point("A", "2026-09-01T00:00:00", 1e9),
        point("C", "2026-09-01T00:00:00", 3e8),
        point("D", "2026-09-01T00:00:00", 2e8),
      ],
      ["A"],
    );
    expect(rows[0][OTHERS_KEY]).toBeCloseTo(0.5);
  });

  test("buckets come out in chronological order whatever the input order", () => {
    const rows = stackDeviceSeries(
      [point("A", "2026-09-02T00:00:00", 1), point("A", "2026-09-01T00:00:00", 1)],
      ["A"],
    );
    expect(rows.map((r) => r.bucket)).toEqual(["2026-09-01T00:00:00", "2026-09-02T00:00:00"]);
  });

  test("no points gives no rows", () => {
    expect(stackDeviceSeries([], ["A"])).toEqual([]);
  });
});
