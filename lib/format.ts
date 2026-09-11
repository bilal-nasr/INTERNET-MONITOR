const GB = 1e9;

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
