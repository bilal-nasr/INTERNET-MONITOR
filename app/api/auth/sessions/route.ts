import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/server";
import { listSessions, revokeAllSessions, toPublicSession } from "@/lib/auth/sessions";
import { dictionaryFromRequest } from "@/lib/i18n/request";

/** Every browser signed in to this account, the caller's own row flagged. */
export async function GET(request: Request) {
  const d = dictionaryFromRequest(request);
  try {
    const auth = await requireApiAuth(request);
    const rows = await listSessions(auth.user.id, auth.sessionId);
    return NextResponse.json({ sessions: rows.map(toPublicSession) });
  } catch (err) {
    return errorResponse(err, d);
  }
}

/** Sign every other browser out. The caller keeps its own session. */
export async function DELETE(request: Request) {
  const d = dictionaryFromRequest(request);
  try {
    const auth = await requireApiAuth(request);
    await revokeAllSessions(auth.user.id, auth.sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, d);
  }
}
