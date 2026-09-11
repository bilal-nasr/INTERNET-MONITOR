import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const maxDuration = 15;

/**
 * Liveness and readiness in one: the process answering at all proves it is
 * alive, and the database round-trip proves it can actually serve requests.
 * Used by the container HEALTHCHECK and by platform health probes.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await db.one("SELECT 1 AS ok");
    return NextResponse.json(
      { status: "ok", database: true, latency_ms: Date.now() - startedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[health] database unreachable:", err);
    return NextResponse.json(
      {
        status: "degraded",
        database: false,
        latency_ms: Date.now() - startedAt,
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
