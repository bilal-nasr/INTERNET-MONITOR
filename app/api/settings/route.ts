import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, errorResponse } from "@/lib/api";
import { getSettings, toPublicSettings, updateSettings, type SettingsPatch } from "@/lib/settings";
import { isValidTimeZone, timeToMinutes } from "@/lib/time";

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM (24-hour)");

const patchSchema = z
  .object({
    quota_gb: z.coerce.number().positive("quota_gb must be greater than 0").max(100_000),
    window_start: hhmm,
    window_end: hhmm,
    timezone: z.string().trim().min(1).refine(isValidTimeZone, "unknown IANA timezone"),
    alert_email_to: z.email("invalid email address").trim().nullable(),
    wan_interface_name: z.string().trim().min(1, "interface name is required").max(100),
    polling_enabled: z.boolean(),
  })
  .partial()
  .strict();

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json(toPublicSettings(settings));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("request body must be JSON");
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const { fieldErrors, formErrors } = z.flattenError(parsed.error);
    return badRequest("validation failed", formErrors.length ? { ...fieldErrors, _: formErrors } : fieldErrors);
  }

  const patch: SettingsPatch = { ...parsed.data };

  try {
    // Cross-field rule: window_end must be after window_start, using the
    // stored value for whichever side the request did not include.
    const current = await getSettings();
    const start = timeToMinutes(patch.window_start ?? current.window_start);
    const end = timeToMinutes(patch.window_end ?? current.window_end);
    if (start === null || end === null || end <= start) {
      return badRequest("validation failed", {
        window_end: ["window_end must be after window_start"],
      });
    }

    const updated = await updateSettings(patch);
    return NextResponse.json(toPublicSettings(updated));
  } catch (err) {
    return errorResponse(err);
  }
}
