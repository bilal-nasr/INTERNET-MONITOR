/**
 * Light, dark, or whatever the device is set to.
 *
 * This is a preference of the browser, not of the monitor: it lives in
 * localStorage rather than the settings row, so a phone left on dark does not
 * turn the desktop dark too. The choice lands on `<html data-theme>`, which the
 * stylesheet reads; "system" is the attribute's absence, left to the media query.
 */

export const APPEARANCES = ["system", "light", "dark"] as const;

export type Appearance = (typeof APPEARANCES)[number];

const STORAGE_KEY = "appearance";
const CHANGE_EVENT = "appearancechange";

function isAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCES as readonly string[]).includes(value);
}

/**
 * Run in `<head>` before the body is parsed, so a stored choice is on the page
 * before the first paint instead of flashing the system theme first. Every page
 * is prerendered without the attribute; this is where it is set on load.
 *
 * It also follows a change made in another tab, which arrives as a storage
 * event. The window outlives client-side navigation, so one listener per load
 * covers every page the tab goes on to show.
 */
export const APPEARANCE_SCRIPT = `(function(){var k=${JSON.stringify(STORAGE_KEY)},r=document.documentElement;function a(){try{var t=localStorage.getItem(k);if(t==="light"||t==="dark")r.setAttribute("data-theme",t);else r.removeAttribute("data-theme")}catch(e){}}a();addEventListener("storage",function(e){if(e.key===k||e.key===null)a()})})()`;

export function readAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isAppearance(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Store the choice and repaint the page at once. */
export function setAppearance(appearance: Appearance) {
  try {
    if (appearance === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, appearance);
  } catch {
    // Storage refused (private mode, blocked site data): the choice still
    // applies to this page, it just is not remembered.
  }
  if (appearance === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", appearance);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Call `onChange` when the choice changes, in this tab or another. */
export function subscribeAppearance(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
