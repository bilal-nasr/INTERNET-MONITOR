import { badRequest, errorResponse } from "@/lib/api";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import type { Reading } from "@/lib/usage";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 2000;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** Fetch readings in id order, one page at a time, so exports never load the whole range in memory. */
async function fetchPage(from: string, to: string, timezone: string, afterId: number): Promise<Reading[]> {
  return db.any<Reading>(
    `SELECT id, recorded_at, tx_bytes, rx_bytes, total_bytes
     FROM interface_readings
     WHERE recorded_at >= ($1::date::timestamp AT TIME ZONE $3::text)
       AND recorded_at <  (($2::date + 1)::timestamp AT TIME ZONE $3::text)
       AND id > $4
     ORDER BY id ASC
     LIMIT $5`,
    [from, to, timezone, afterId, PAGE_SIZE],
  );
}

function toRow(r: Reading) {
  return {
    recorded_at: r.recorded_at.toISOString(),
    tx_bytes: r.tx_bytes,
    rx_bytes: r.rx_bytes,
    total_bytes: r.total_bytes,
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const format = (params.get("format") ?? "csv").toLowerCase();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  if (format !== "csv" && format !== "json") return badRequest("format must be csv or json");
  if (!isValidDate(from) || !isValidDate(to)) return badRequest("from and to must be YYYY-MM-DD dates");
  if (from > to) return badRequest("from must be on or before to");

  let timezone: string;
  try {
    timezone = (await getSettings()).timezone;
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  const filename = `interface_readings_${from}_${to}.${format}`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let afterId = 0;
        let first = true;

        controller.enqueue(
          encoder.encode(format === "csv" ? "recorded_at,tx_bytes,rx_bytes,total_bytes\n" : "["),
        );

        for (;;) {
          const page = await fetchPage(from, to, timezone, afterId);
          if (page.length === 0) break;

          let chunk = "";
          for (const r of page) {
            const row = toRow(r);
            if (format === "csv") {
              chunk += `${row.recorded_at},${row.tx_bytes},${row.rx_bytes},${row.total_bytes}\n`;
            } else {
              chunk += (first ? "" : ",") + JSON.stringify(row);
              first = false;
            }
          }
          controller.enqueue(encoder.encode(chunk));
          afterId = page[page.length - 1].id;
          if (page.length < PAGE_SIZE) break;
        }

        if (format === "json") controller.enqueue(encoder.encode("]"));
        controller.close();
      } catch (err) {
        console.error("[api] export failed:", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
