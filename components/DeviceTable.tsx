"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { Pager, revealTop } from "@/components/Pager";
import { Toast, type ToastState } from "@/components/Toast";
import { formatBytes } from "@/lib/format";
import { fill } from "@/lib/i18n";
import type { DeviceUsage } from "@/lib/devices/usage";

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-series-1 focus:ring-2 focus:ring-series-1/30";
const buttonClass = "rounded-md border border-border px-2 py-1 text-xs hover:bg-border/60 disabled:opacity-50";

/** Rows per page. */
const PAGE_SIZE = 10;

/**
 * One row per device with an inline rename. The name is saved through
 * /api/devices/[mac] and the page is refreshed so the server-rendered label,
 * chart legend and tiles all pick it up at once.
 *
 * Paged in the browser, by position. A LAN has tens of devices, not thousands,
 * and the ranking by traffic is recomputed on every refresh, so there is no
 * stable row to hang a cursor on: the whole ranked list arrives at once and
 * only one page of it is drawn.
 */
export function DeviceTable({
  devices,
  total,
  timezone,
}: {
  devices: DeviceUsage[];
  /** Every device with traffic in the range, which can exceed the rows sent. */
  total: number;
  timezone: string;
}) {
  const { locale, d, f } = useI18n();
  const router = useRouter();
  const top = useRef<HTMLDivElement>(null);
  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(devices.length / PAGE_SIZE));
  // A refresh can shorten the list under the reader; stay on the last page then.
  const page = Math.min(requestedPage, pageCount - 1);
  const shown = devices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);

  function go(next: number) {
    setPage(next);
    setEditing(null);
    revealTop(top.current);
  }

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
    <div ref={top} className="scroll-mt-4 space-y-4">
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
            {shown.map((device) => (
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

      <Pager
        start={page * PAGE_SIZE + 1}
        end={page * PAGE_SIZE + shown.length}
        total={Math.max(total, devices.length)}
        hasPrevious={page > 0}
        hasNext={page < pageCount - 1}
        onFirst={() => go(0)}
        onPrevious={() => go(page - 1)}
        onNext={() => go(page + 1)}
      />
    </div>
  );
}
