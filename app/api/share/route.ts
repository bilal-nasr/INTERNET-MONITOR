import { NextResponse } from "next/server";
import { errorResponse, rejectUnauthenticated } from "@/lib/api";
import { localeFromRequest, dictionaryFromRequest } from "@/lib/i18n/request";
import { publicBaseUrl } from "@/lib/public-url";
import { updateSettings } from "@/lib/settings";
import { generateShareToken } from "@/lib/share";

/**
 * Create or replace the read-only link. There is one link at a time: storing a
 * new token is what revokes the old one, so "replace" and "create" are the
 * same operation.
 */
export async function POST(request: Request) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;
  try {
    const token = generateShareToken();
    await updateSettings({ share_token: token });
    const url = `${publicBaseUrl(request)}/${localeFromRequest(request)}/share/${token}`;
    return NextResponse.json({ token, url });
  } catch (err) {
    return errorResponse(err, d);
  }
}

/** Turn sharing off. Every copy of the old link stops working. */
export async function DELETE(request: Request) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;
  try {
    await updateSettings({ share_token: null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, d);
  }
}
