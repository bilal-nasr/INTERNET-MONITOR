/** Shared classes for the auth and account forms, matching the settings form. */
export const inputClass =
  "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-series-1 focus:ring-2 focus:ring-series-1/30";
export const labelClass = "block text-sm font-medium";
export const hintClass = "mt-1 text-xs text-muted";
export const primaryButtonClass =
  "inline-flex w-full items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-border/60 disabled:opacity-50";

/**
 * One sentence from a failed response: the first field error when there is
 * one, otherwise the message, otherwise the status.
 */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; details?: Record<string, string[] | undefined> };
    if (body.details && typeof body.details === "object") {
      for (const errors of Object.values(body.details)) {
        if (errors && errors.length) return errors[0];
      }
    }
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}
