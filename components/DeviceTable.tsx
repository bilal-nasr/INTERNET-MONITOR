"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Toast, type ToastState } from "@/components/Toast";
import { formatBytes } from "@/lib/format";
import { fill } from "@/lib/i18n";
import type { DeviceUsage } from "@/lib/devices/usage";

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-series-1 focus:ring-2 focus:ring-series-1/30";
const buttonClass = "rounded-md border border-border px-2 py-1 text-xs hover:bg-border/60 disabled:opacity-50";

/**
 * One row per device with an inline rename. The name is saved through
 * /api/devices/[mac] and the page is refreshed so the server-rendered label,
 * chart legend and tiles all pick it up at once.
 */
export function DeviceTable({ devices, timezone }: { devices: DeviceUsage[]; timezone: string }) {
  const { locale, d, f } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  function startEdit(device: DeviceUsage) {
    setEditing(device.mac);
    setDraft(device.label === device.mac ? "" : device.label);
  }

  async function save(mac: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(mac)}?lang=${locale}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: draft.trim() === "" ? null : draft.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? fill(d.settings.httpError, { status: res.status }));
      }
      setEditing(null);
      setToast({ kind: "success", message: d.devices.renamed });
      router.refresh();
    } catch (err) {
      setToast({
        kind: "error",
        message: fill(d.devices.renameFailed, { reason: err instanceof Error ? err.message : String(err) }),
      });
    } finally {
      setSaving(false);
    }
  }

  if (devices.length === 0) {
    return <p className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">{d.devices.empty}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border">
            <th className="px-4 py-2 text-start font-medium">{d.devices.device}</th>
            <th className="px-4 py-2 text-end font-medium">{d.common.download}</th>
            <th className="px-4 py-2 text-end font-medium">{d.common.upload}</th>
            <th className="px-4 py-2 text-end font-medium">{d.common.total}</th>
            <th className="px-4 py-2 text-end font-medium">{d.devices.lastSeen}</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.mac} className="border-b border-border last:border-0">
              <td className="px-4 py-2">
                {editing === device.mac ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save(device.mac);
                    }}
                  >
                    <input
                      autoFocus
                      value={draft}
                      maxLength={100}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={d.devices.namePlaceholder}
                      className={inputClass}
                    />
                    <button type="submit" disabled={saving} className={buttonClass}>
                      {d.devices.saveName}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className={buttonClass}>
                      {d.devices.cancel}
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="font-medium">{device.label}</div>
                    {/* Identifiers stay ltr in Arabic; a MAC read right to left is a different MAC. */}
                    <div className="font-mono text-xs text-muted" dir="ltr">
                      {device.mac}
                      {device.ip ? ` · ${device.ip}` : ""}
                      {device.hostname && device.hostname !== device.label ? ` · ${device.hostname}` : ""}
                    </div>
                  </>
                )}
              </td>
              <td className="px-4 py-2 text-end tabular-nums">{formatBytes(device.rx_bytes)}</td>
              <td className="px-4 py-2 text-end tabular-nums">{formatBytes(device.tx_bytes)}</td>
              <td className="px-4 py-2 text-end font-medium tabular-nums">{formatBytes(device.total_bytes)}</td>
              <td className="px-4 py-2 text-end text-xs tabular-nums text-muted">
                {f.stamp(device.last_seen, timezone)}
              </td>
              <td className="px-4 py-2 text-end">
                {editing !== device.mac && (
                  <button type="button" onClick={() => startEdit(device)} className={buttonClass}>
                    {d.devices.rename}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
