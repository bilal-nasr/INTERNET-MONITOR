import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { QUOTA_PUSH_TEMPLATE, TEMPLATE_DEFAULTS } from "@/lib/router/script-template";
import {
  escapeRouterOsString,
  fillScriptSecret,
  renderQuotaPushScript,
  scriptBodyAfterMarker,
  SECRET_PLACEHOLDER,
} from "@/lib/router/script";

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

/**
 * The path the settings page actually takes: RouterScriptCard renders the
 * script with the placeholder where the secret goes, and RouterScriptView
 * swaps the real secret in for the copy button.
 */
describe("fillScriptSecret", () => {
  const rendered = renderQuotaPushScript({ ...TEMPLATE_DEFAULTS, secret: SECRET_PLACEHOLDER });

  test("the placeholder survives rendering, so the view has something to replace", () => {
    expect(rendered).toContain(`:local secret        "${SECRET_PLACEHOLDER}"`);
  });

  test("escapes the secret the card could not escape for itself", () => {
    // A quote, a backslash and a dollar sign, each fatal raw.
    const out = fillScriptSecret(rendered, 'pa"ss\\$x');
    expect(out).toContain(':local secret        "pa\\"ss\\\\\\$x"');
    expect(out).not.toContain(SECRET_PLACEHOLDER);
  });

  test("a secret containing replacement patterns is inserted as itself", () => {
    // "$&", "$1" and "$`" are String.replace's own patterns: with a string
    // replacement they would expand to the match, an empty group and the
    // text before the match.
    expect(fillScriptSecret(':local secret "{{secret}}"', "a$&b")).toBe(':local secret "a\\$&b"');
    expect(fillScriptSecret(':local secret "{{secret}}"', "a$1b")).toBe(':local secret "a\\$1b"');
    expect(fillScriptSecret(':local secret "{{secret}}"', "a$`b")).toBe(':local secret "a\\$`b"');
  });

  test("leaves an ordinary secret and the rest of the script alone", () => {
    const secret = "7cf711709d5cf11b9c773d69644f0707";
    expect(fillScriptSecret(rendered, secret)).toBe(renderQuotaPushScript({ ...TEMPLATE_DEFAULTS, secret }));
  });
});
