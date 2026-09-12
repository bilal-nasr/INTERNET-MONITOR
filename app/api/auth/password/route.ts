import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse } from "@/lib/api";
import { requireApiAuth } from "@/lib/auth/server";
import { revokeAllSessions } from "@/lib/auth/sessions";
import { findUserById, updatePassword } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/password";
import type { Dictionary } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";

const MIN_PASSWORD_LENGTH = 8;

function bodySchema(d: Dictionary) {
  return z
    .object({
      current_password: z.string().min(1, d.errors.passwordRequired).max(1000),
      new_password: z.string().min(MIN_PASSWORD_LENGTH, d.errors.passwordTooShort).max(1000),
      confirm_password: z.string().max(1000),
    })
    .refine((v) => v.new_password === v.confirm_password, {
      message: d.errors.passwordMismatch,
      path: ["confirm_password"],
    });
}

/** Change the signed-in account's password. Every other browser is signed out; this one stays. */
export async function POST(request: Request) {
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
    const user = await findUserById(auth.user.id);
    if (!user || !(await verifyPassword(parsed.data.current_password, user.password_hash))) {
      return badRequest(d.errors.validationFailed, { current_password: [d.errors.wrongPassword] });
    }
    await updatePassword(user.id, parsed.data.new_password);
    await revokeAllSessions(user.id, auth.sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, d);
  }
}
