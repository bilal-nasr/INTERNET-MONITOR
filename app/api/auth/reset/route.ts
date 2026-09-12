import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse } from "@/lib/api";
import { consumePasswordReset } from "@/lib/auth/reset";
import { looksLikeToken } from "@/lib/auth/tokens";
import type { Dictionary } from "@/lib/i18n";
import { dictionaryFromRequest } from "@/lib/i18n/request";

const MIN_PASSWORD_LENGTH = 8;

function bodySchema(d: Dictionary) {
  return z
    .object({
      token: z.string().refine(looksLikeToken, d.errors.resetInvalid),
      password: z.string().min(MIN_PASSWORD_LENGTH, d.errors.passwordTooShort).max(1000),
      confirm_password: z.string().max(1000),
    })
    .refine((v) => v.password === v.confirm_password, {
      message: d.errors.passwordMismatch,
      path: ["confirm_password"],
    });
}

/** Finish a "forgot password": a live token plus a new password. Signs every browser out. */
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
    const ok = await consumePasswordReset(parsed.data.token, parsed.data.password);
    if (!ok) return badRequest(d.errors.validationFailed, { token: [d.errors.resetInvalid] });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, d);
  }
}
