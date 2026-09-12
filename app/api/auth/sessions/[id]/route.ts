import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/server";
import { revokeSessionById } from "@/lib/auth/sessions";
import { fill } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";

/**
 * Sign one browser out. The caller's own session is refused: ending it here
 * would leave the browser holding cookies for a dead row, which is what the
 * logout endpoint exists to clean up.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = dictionaryFromRequest(request);
  const { id: raw } = await params;
  const id = /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  if (id === null) return badRequest(fill(d.errors.notASessionRowId, { value: raw }));

  try {
    const auth = await requireApiAuth(request);
    if (id === auth.sessionId) {
      return NextResponse.json(
        { error: "cannot_revoke_current", message: d.errors.cannotRevokeCurrent },
        { status: 400 },
      );
    }
    const revoked = await revokeSessionById(auth.user.id, id);
    if (!revoked) {
      return NextResponse.json(
        { error: "session_not_found", message: d.errors.sessionNotFound },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, d);
  }
}
