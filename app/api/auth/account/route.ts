import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/server";
import { updateEmail } from "@/lib/auth/users";
import type { Dictionary } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";

function bodySchema(d: Dictionary) {
  return z.object({
    email: z.email(d.errors.invalidEmail).trim().max(320).nullable(),
  });
}

/** The signed-in account, as the settings page shows it. */
export async function GET(request: Request) {
  const d = dictionaryFromRequest(request);
  try {
    const auth = await requireApiAuth(request);
    return NextResponse.json({ user: auth.user });
  } catch (err) {
    return errorResponse(err, d);
  }
}

/** Set or clear the account email, which is where a password-reset link goes. */
export async function PUT(request: Request) {
  const d = dictionaryFromRequest(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(d.errors.badJson);
  }
  const parsed = bodySchema(d).safeParse(body);
  if (!parsed.success) {
    return badRequest(d.errors.validationFailed, z.flattenError(parsed.error).fieldErrors);
  }

  try {
    const auth = await requireApiAuth(request);
    const user = await updateEmail(auth.user.id, parsed.data.email);
    return NextResponse.json({ user });
  } catch (err) {
    return errorResponse(err, d);
  }
}
