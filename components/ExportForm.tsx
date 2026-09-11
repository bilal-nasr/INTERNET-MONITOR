"use client";

import { useState } from "react";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-series-1 focus:ring-2 focus:ring-series-1/30";

export function ExportForm() {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);

  const [from, setFrom] = useState(isoDate(weekAgo));
  const [to, setTo] = useState(isoDate(today));
  const [error, setError] = useState<string | null>(null);

  function download(format: "csv" | "json") {
    if (!from || !to) {
      setError("Pick both dates.");
      return;
    }
    if (from > to) {
      setError("The start date must be on or before the end date.");
      return;
    }
    setError(null);
    const url = `/api/export?format=${format}&from=${from}&to=${to}`;
    // The route sets Content-Disposition: attachment, so navigating triggers a download.
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
        <div>
          <label htmlFor="from" className="block text-sm font-medium">From</label>
          <input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="to" className="block text-sm font-medium">To</label>
          <input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        Dates are inclusive and interpreted in the timezone from Settings. Columns: recorded_at (ISO 8601 UTC), tx_bytes,
        rx_bytes, total_bytes.
      </p>
      {error && <p className="mt-2 text-sm text-status-critical">{error}</p>}
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => download("csv")}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          Download CSV
        </button>
        <button
          type="button"
          onClick={() => download("json")}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-border/60"
        >
          Download JSON
        </button>
      </div>
    </section>
  );
}
