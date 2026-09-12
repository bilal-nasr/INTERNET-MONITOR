/**
 * A browser and an operating system, read off a User-Agent string.
 *
 * Only for the "signed-in browsers" list on the settings page, where "Chrome
 * on Windows" is enough to recognise a device. Keys rather than words come
 * back, so the page can name them in its own language.
 *
 * Order matters in both tables: Edge and Opera carry "Chrome" in their string,
 * Chrome carries "Safari", and an iPad may claim to be a Macintosh, so the more
 * specific pattern is listed first.
 */

export type BrowserKey = "chrome" | "firefox" | "safari" | "edge" | "opera" | "unknown";
export type OsKey = "windows" | "macos" | "ios" | "ipad" | "android" | "linux" | "unknown";

export interface UserAgentDescription {
  browser: BrowserKey;
  os: OsKey;
}

const BROWSERS: [RegExp, BrowserKey][] = [
  [/\bEdg(?:e|A|iOS)?\//, "edge"],
  [/\bOPR\/|\bOpera\b/, "opera"],
  [/\bFirefox\/|\bFxiOS\//, "firefox"],
  [/\bChrome\/|\bCriOS\//, "chrome"],
  [/\bSafari\//, "safari"],
];

const SYSTEMS: [RegExp, OsKey][] = [
  [/\biPad\b/, "ipad"],
  [/\biPhone\b|\biPod\b/, "ios"],
  [/\bAndroid\b/, "android"],
  [/\bWindows\b/, "windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macos"],
  [/\bLinux\b|\bX11\b/, "linux"],
];

export function describeUserAgent(ua: string | null | undefined): UserAgentDescription {
  if (!ua) return { browser: "unknown", os: "unknown" };
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? "unknown";
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? "unknown";
  return { browser, os };
}
