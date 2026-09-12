import { QUOTA_PUSH_TEMPLATE } from "@/lib/router/script-template";

/** The values that vary between installs. Everything else in the script is fixed. */
export interface ScriptVars {
  iface: string;
  url: string;
  secret: string;
  throttleQueue: string;
}

/**
 * Inside a double-quoted RouterOS string, backslash escapes, a quote ends the
 * string and a dollar sign starts a variable. Each is escaped so any value
 * survives as itself. The backslash goes first so the others' escapes are
 * not doubled.
 */
export function escapeRouterOsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}

export function renderQuotaPushScript(vars: ScriptVars): string {
  let out = QUOTA_PUSH_TEMPLATE;
  for (const name of ["iface", "url", "secret", "throttleQueue"] as const) {
    // The replacement is returned from a function so that a value containing
    // "$&" or "$'" is inserted as itself instead of being read as one of
    // String.replace's own patterns.
    out = out.replace(`{{${name}}}`, () => escapeRouterOsString(vars[name]));
  }
  return out;
}

/**
 * The part of a .rsc file a person pastes into WinBox: everything after the
 * first line of dashes. Line endings are normalised so the same file reads
 * the same on Windows.
 */
export function scriptBodyAfterMarker(fileText: string): string {
  const lines = fileText.replace(/\r\n/g, "\n").split("\n");
  const marker = lines.findIndex((line) => /^# -{10,}$/.test(line));
  if (marker === -1) throw new Error("script has no dashed marker line");
  return lines.slice(marker + 1).join("\n");
}
