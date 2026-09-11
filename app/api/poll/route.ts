import { NextResponse } from "next/server";
import { errorResponse, isCronAuthorized } from "@/lib/api";
import { runPoll } from "@/lib/poll";

// Vercel functions default to 300s; the router call itself times out at 15s.
export const maxDuration = 60;

async function handle(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runPoll();
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

/** External schedulers (GitHub Actions) call POST. */
export async function POST(request: Request) {
  return handle(request);
}

/** Vercel Cron invokes the path with GET and the same Bearer header. */
export async function GET(request: Request) {
  return handle(request);
}
