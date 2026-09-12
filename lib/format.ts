const GB = 1e9;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * A value made safe to drop into hand-written HTML.
 *
 * The one escaper for everything that builds markup by hand: the three email
 * renderers and the password-reset mail. They each carried their own copy and
 * the copies had drifted -- only one escaped the apostrophe -- so a name or a
 * URL with a `'` in it reached the markup intact, which matters the moment an
 * attribute is written with single quotes rather than double. All five
 * characters are escaped here so one value is safe in text and in an attribute
 * quoted either way.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Decimal gigabytes, matching the quota definition (quota_gb * 1e9). */
export function bytesToGb(bytes: number): number {
  return bytes / GB;
}

export function formatBytes(bytes: number, digits = 2): string {
  if (!Number.isFinite(bytes)) return "-";
  const abs = Math.abs(bytes);
  if (abs >= 1e12) return `${(bytes / 1e12).toFixed(digits)} TB`;
  if (abs >= 1e9) return `${(bytes / 1e9).toFixed(digits)} GB`;
  if (abs >= 1e6) return `${(bytes / 1e6).toFixed(digits)} MB`;
  if (abs >= 1e3) return `${(bytes / 1e3).toFixed(digits)} KB`;
  return `${Math.round(bytes)} B`;
}

export function quotaBytes(quotaGb: number): number {
  return Math.round(quotaGb * GB);
}

/**
 * A throughput in bits per second, decimal units, the way ISPs quote a link.
 * Bytes in, because that is what the counters hold; a negative rate cannot
 * happen on a monotonic counter and is clamped rather than shown.
 */
export function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond)) return "-";
  const bits = Math.max(0, bytesPerSecond) * 8;
  if (bits >= 1e9) return `${(bits / 1e9).toFixed(2)} Gbit/s`;
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mbit/s`;
  if (bits >= 1e3) return `${Math.round(bits / 1e3)} kbit/s`;
  return `${Math.round(bits)} bit/s`;
}
