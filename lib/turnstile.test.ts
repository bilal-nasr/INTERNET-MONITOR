import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generateShareToken } from "@/lib/share";
import {
  SHARE_PASS_TTL_SECONDS,
  issueSharePass,
  sharePassValid,
  turnstileEnabled,
  verifyTurnstile,
} from "@/lib/turnstile";

function withKeys() {
  vi.stubEnv("TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("with no keys", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  });

  test("the check is off and everything passes", async () => {
    expect(turnstileEnabled()).toBe(false);
    expect(await verifyTurnstile(undefined, null)).toBe(true);
    expect(issueSharePass(generateShareToken())).toBeNull();
    expect(sharePassValid(null, generateShareToken())).toBe(true);
  });

  test("one key alone does not turn it on", () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    expect(turnstileEnabled()).toBe(false);
  });
});

describe("verifyTurnstile", () => {
  beforeEach(withKeys);

  test("a missing or oversized token is refused without asking Cloudflare", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyTurnstile(undefined, null)).toBe(false);
    expect(await verifyTurnstile("", null)).toBe(false);
    expect(await verifyTurnstile("x".repeat(2049), null)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Cloudflare's verdict is the answer, and the address is passed on", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as URLSearchParams;
      expect(form.get("response")).toBe("good");
      expect(form.get("remoteip")).toBe("203.0.113.9");
      return Response.json({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyTurnstile("good", "203.0.113.9")).toBe(true);

    vi.stubGlobal("fetch", async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await verifyTurnstile("bad", null)).toBe(false);
  });

  test("an unreachable Cloudflare fails closed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    expect(await verifyTurnstile("good", null)).toBe(false);

    vi.stubGlobal("fetch", async () => new Response("oops", { status: 500 }));
    expect(await verifyTurnstile("good", null)).toBe(false);
  });
});

describe("share pass", () => {
  beforeEach(withKeys);
  const shareToken = generateShareToken();
  const now = Date.UTC(2026, 8, 12, 10, 0, 0);

  test("a fresh pass is accepted", () => {
    const pass = issueSharePass(shareToken, now);
    expect(sharePassValid(pass, shareToken, now)).toBe(true);
  });

  test("it lapses after its lifetime", () => {
    const pass = issueSharePass(shareToken, now);
    expect(sharePassValid(pass, shareToken, now + (SHARE_PASS_TTL_SECONDS - 1) * 1000)).toBe(true);
    expect(sharePassValid(pass, shareToken, now + SHARE_PASS_TTL_SECONDS * 1000)).toBe(false);
  });

  test("replacing the link voids it", () => {
    const pass = issueSharePass(shareToken, now);
    expect(sharePassValid(pass, generateShareToken(), now)).toBe(false);
  });

  test("a pushed-out expiry breaks the signature", () => {
    const pass = issueSharePass(shareToken, now)!;
    const [expiry, signature] = pass.split(".");
    expect(sharePassValid(`${Number(expiry) + 86_400}.${signature}`, shareToken, now)).toBe(false);
  });

  test("another secret's pass is refused", () => {
    const pass = issueSharePass(shareToken, now);
    vi.stubEnv("TURNSTILE_SECRET_KEY", "a-different-secret");
    expect(sharePassValid(pass, shareToken, now)).toBe(false);
  });

  test("garbage is refused", () => {
    expect(sharePassValid(null, shareToken, now)).toBe(false);
    expect(sharePassValid("", shareToken, now)).toBe(false);
    expect(sharePassValid("not-a-pass", shareToken, now)).toBe(false);
    expect(sharePassValid("123.short", shareToken, now)).toBe(false);
  });
});
