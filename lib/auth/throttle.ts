/**
 * A small brake on password guessing.
 *
 * Held in memory, per process: enough to turn an online guess from thousands
 * a minute into a handful, which is what matters against a seeded default
 * password. It is not shared between instances and resets on restart; a hosted
 * deployment that wants more puts a rate limit in front of the app.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

interface Bucket {
  failures: number;
  /** When the window opened; the bucket is forgotten once it is WINDOW_MS old. */
  since: number;
}

const buckets = new Map<string, Bucket>();

function live(key: string, now: number): Bucket | null {
  const bucket = buckets.get(key);
  if (!bucket) return null;
  if (now - bucket.since > WINDOW_MS) {
    buckets.delete(key);
    return null;
  }
  return bucket;
}

/** Seconds until the key may try again, or 0 when it may try now. */
export function retryAfterSeconds(key: string, now = Date.now()): number {
  const bucket = live(key, now);
  if (!bucket || bucket.failures < MAX_FAILURES) return 0;
  return Math.max(1, Math.ceil((bucket.since + WINDOW_MS - now) / 1000));
}

export function recordFailure(key: string, now = Date.now()): void {
  const bucket = live(key, now);
  if (bucket) bucket.failures += 1;
  else buckets.set(key, { failures: 1, since: now });
  // Keep the map from growing without bound under a spray of usernames.
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (now - b.since > WINDOW_MS) buckets.delete(k);
  }
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}
