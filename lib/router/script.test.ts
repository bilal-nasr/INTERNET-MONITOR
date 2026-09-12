import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { QUOTA_PUSH_TEMPLATE, TEMPLATE_DEFAULTS } from "@/lib/router/script-template";
import { escapeRouterOsString, renderQuotaPushScript, scriptBodyAfterMarker } from "@/lib/router/script";

const rsc = readFileSync(join(process.cwd(), "router", "quota-push.rsc"), "utf8");

describe("scriptBodyAfterMarker", () => {
  test("returns everything after the first dashed comment line", () => {
    expect(scriptBodyAfterMarker("# head\n# ------------\n:local a 1\n")).toBe(":local a 1\n");
  });

  test("tolerates CRLF line endings", () => {
    expect(scriptBodyAfterMarker("# head\r\n# ------------\r\n:local a 1\r\n")).toBe(":local a 1\n");
  });

  test("throws when there is no marker, so a broken file is noticed", () => {
    expect(() => scriptBodyAfterMarker("no marker here")).toThrow(/marker/);
  });
});

describe("the template and router/quota-push.rsc", () => {
  test("are the same script", () => {
    // Filling the template with the file's own placeholder values must give
    // the file back exactly. Whoever edits one must edit the other.
    expect(renderQuotaPushScript(TEMPLATE_DEFAULTS)).toBe(scriptBodyAfterMarker(rsc));
  });

  test("the template names every variable exactly once at the top", () => {
    for (const name of ["iface", "url", "secret", "throttleQueue"]) {
      expect(QUOTA_PUSH_TEMPLATE.split(`{{${name}}}`).length).toBe(2);
    }
  });
});

describe("escapeRouterOsString", () => {
  test("escapes the characters RouterOS treats specially inside double quotes", () => {
    expect(escapeRouterOsString('a"b')).toBe('a\\"b');
    expect(escapeRouterOsString("a\\b")).toBe("a\\\\b");
    expect(escapeRouterOsString("a$b")).toBe("a\\$b");
  });

  test("leaves an ordinary secret alone", () => {
    expect(escapeRouterOsString("7cf711709d5cf11b9c773d69644f0707")).toBe("7cf711709d5cf11b9c773d69644f0707");
  });
});

describe("renderQuotaPushScript", () => {
  test("fills the four locals", () => {
    const out = renderQuotaPushScript({
      iface: "pppoe-out1",
      url: "https://monitor.example.com/api/ingest",
      secret: "s3cret",
      throttleQueue: "quota-throttle",
    });
    expect(out).toContain(':local iface         "pppoe-out1"');
    expect(out).toContain(':local url           "https://monitor.example.com/api/ingest"');
    expect(out).toContain(':local secret        "s3cret"');
    expect(out).toContain(':local throttleQueue "quota-throttle"');
    expect(out).not.toContain("{{");
  });

  test("escapes values so a secret with a quote cannot break the script", () => {
    const out = renderQuotaPushScript({ ...TEMPLATE_DEFAULTS, secret: 'pa"ss$1' });
    expect(out).toContain(':local secret        "pa\\"ss\\$1"');
  });
});
