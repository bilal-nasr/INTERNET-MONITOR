import { NextResponse } from "next/server";
import { errorResponse, isCronAuthorized } from "@/lib/api";
import { runTick } from "@/lib/cron/tick";

export const maxDuration = 60;

/**
 * The heartbeat. Called by whichever scheduler the deployment has (Vercel
 * Cron, a GitHub Actions schedule, a curl loop next to the container), and by
 * hand for testing. GET and POST behave the same because Vercel Cron and
 * GitHub's curl send GET while the docs and the router idiom use POST.
 * Requires `Authorization: Bearer $CRON_SECRET`, the same secret as the ingest.
 */
async function handle(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runTick();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
