import type { Reading } from "@/lib/usage";

/**
 * Throughput between consecutive readings.
 *
 * Same delta rule as every aggregate in lib/stats.ts, with one difference: a
 * counter that went backwards means the interface restarted, and while the
 * totals treat the new value as traffic since the restart, a *rate* over that
 * pair would be meaningless, so the pair is skipped. A gap longer than
 * `maxGapSeconds` is an outage rather than a measurement interval and is
 * skipped for the same reason.
 */
export interface RatePoint {
  /** ISO instant of the later reading of the pair. */
  at: string;
  bytes_per_second: number;
  tx_per_second: number;
  rx_per_second: number;
}

export function ratesFromReadings(readings: Reading[], maxGapSeconds = 300): RatePoint[] {
  const out: RatePoint[] = [];
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const cur = readings[i];
    const gap = (cur.recorded_at.getTime() - prev.recorded_at.getTime()) / 1000;
    if (gap <= 0 || gap > maxGapSeconds) continue;
    if (cur.tx_bytes < prev.tx_bytes || cur.rx_bytes < prev.rx_bytes) continue;
    const tx = (cur.tx_bytes - prev.tx_bytes) / gap;
    const rx = (cur.rx_bytes - prev.rx_bytes) / gap;
    out.push({
      at: cur.recorded_at.toISOString(),
      bytes_per_second: tx + rx,
      tx_per_second: tx,
      rx_per_second: rx,
    });
  }
  return out;
}
