import type { AnomalyFlag } from "@/lib/anomaly";
import { formatBytes } from "@/lib/format";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

/**
 * The flagged days, one line each, newest first. Renders nothing when there is
 * nothing to say: an empty "unusual days" box would itself be the odd thing
 * on the page.
 */
export async function AnomalyList({ flags }: { flags: AnomalyFlag[] }) {
  if (flags.length === 0) return null;
  const { d } = await getI18n();
  const newestFirst = [...flags].sort((a, b) => (a.day < b.day ? 1 : -1));
  return (
    <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium">{d.anomaly.heading}</span>
        <span className="text-xs text-muted">{d.anomaly.hint}</span>
      </div>
      <ul className="mt-1 space-y-0.5 tabular-nums">
        {newestFirst.map((f) => (
          <li key={f.day}>
            {fill(d.anomaly.line, {
              day: f.day,
              used: formatBytes(f.used_bytes),
              ratio: Number.isFinite(f.ratio) ? f.ratio.toFixed(1) : "∞",
              baseline: formatBytes(f.baseline_bytes),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
