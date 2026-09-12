import { NextResponse } from "next/server";
import { z } from "zod";
import { isThresholdList, MAX_THRESHOLDS } from "@/lib/alerts/thresholds";
import { badRequest, errorResponse, rejectUnauthenticated } from "@/lib/api";
import type { Dictionary } from "@/lib/i18n";
import { LOCALES } from "@/lib/i18n/config";
import { dictionaryFromRequest } from "@/lib/i18n/request";
import { getSettings, toPublicSettings, updateSettings, type SettingsPatch } from "@/lib/settings";
import { isValidTimeZone, timeToMinutes } from "@/lib/time";

/**
 * The schema is built per request rather than once at module load, because the
 * messages it carries are shown to a person and so belong in that person's
 * language. The rules themselves do not vary.
 */
function patchSchema(d: Dictionary) {
  const e = d.errors;
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, e.timeFormat);

  return z
    .object({
      quota_gb: z.coerce.number().positive(e.quotaPositive).max(100_000),
      monthly_quota_gb: z.coerce.number().positive(e.monthlyQuotaPositive).max(1_000_000),
      // 31 is allowed: shorter months clamp to their last day (see lib/billing.ts).
      billing_cycle_day: z.coerce
        .number()
        .int(e.cycleDayWhole)
        .min(1, e.cycleDayRange)
        .max(31, e.cycleDayRange),
      window_start: hhmm,
      window_end: hhmm,
      timezone: z.string().trim().min(1).refine(isValidTimeZone, e.unknownTimezone),
      alert_email_to: z.email(e.invalidEmail).trim().nullable(),
      wan_interface_name: z.string().trim().min(1, e.interfaceRequired).max(100),
      polling_enabled: z.boolean(),
      language: z.enum(LOCALES, e.unknownLanguage),
      alert_thresholds: z
        .array(z.coerce.number())
        .max(MAX_THRESHOLDS, e.thresholdsInvalid)
        .refine(isThresholdList, e.thresholdsInvalid),
      cycle_alert_thresholds: z
        .array(z.coerce.number())
        .max(MAX_THRESHOLDS, e.thresholdsInvalid)
        .refine(isThresholdList, e.thresholdsInvalid),
      cycle_pace_alert: z.boolean(),
    })
    .partial()
    .strict();
}

export async function GET(request: Request) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;
  try {
    const settings = await getSettings();
    return NextResponse.json(toPublicSettings(settings));
  } catch (err) {
    return errorResponse(err, d);
  }
}

export async function PUT(request: Request) {
  const d = dictionaryFromRequest(request);
  const denied = await rejectUnauthenticated(request, d);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(d.errors.badJson);
  }

  const parsed = patchSchema(d).safeParse(body);
  if (!parsed.success) {
    const { fieldErrors, formErrors } = z.flattenError(parsed.error);
    return badRequest(
      d.errors.validationFailed,
      formErrors.length ? { ...fieldErrors, _: formErrors } : fieldErrors,
    );
  }

  const patch: SettingsPatch = { ...parsed.data };

  try {
    // Cross-field rule: window_end must be after window_start, using the
    // stored value for whichever side the request did not include.
    const current = await getSettings();
    const start = timeToMinutes(patch.window_start ?? current.window_start);
    const end = timeToMinutes(patch.window_end ?? current.window_end);
    if (start === null || end === null || end <= start) {
      return badRequest(d.errors.validationFailed, {
        window_end: [d.errors.windowOrder],
      });
    }

    const updated = await updateSettings(patch);
    return NextResponse.json(toPublicSettings(updated));
  } catch (err) {
    return errorResponse(err, d);
  }
}
