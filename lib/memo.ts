/**
 * One value, loaded on demand and kept for a while.
 *
 * Built for rows that every request reads and almost nothing writes, where a
 * database round trip per request buys nothing but latency. The value is held
 * per process: a write in this process calls `invalidate`, and a write made by
 * another process is picked up once the ttl runs out.
 */

export interface Memoized<T> {
  get(): Promise<T>;
  invalidate(): void;
}

export function memoized<T>(load: () => Promise<T>, ttlMs: number): Memoized<T> {
  let value: { at: number; data: T } | null = null;
  let inflight: Promise<T> | null = null;

  return {
    async get() {
      if (value && Date.now() - value.at < ttlMs) return value.data;
      if (!inflight) {
        inflight = load().then(
          (data) => {
            value = { at: Date.now(), data };
            inflight = null;
            return data;
          },
          (err) => {
            inflight = null;
            throw err;
          },
        );
      }
      return inflight;
    },
    invalidate() {
      value = null;
    },
  };
}
