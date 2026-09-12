import { describe, expect, test } from "vitest";
import { generateShareToken, isPublicApiPath, tokensMatch } from "@/lib/share";

describe("generateShareToken", () => {
  test("is 32 bytes of base64url", () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("never repeats", () => {
    const seen = new Set(Array.from({ length: 50 }, generateShareToken));
    expect(seen.size).toBe(50);
  });
});

describe("tokensMatch", () => {
  const stored = generateShareToken();

  test("the same token matches", () => {
    expect(tokensMatch(stored, stored)).toBe(true);
  });

  test("a different token of the same length does not", () => {
    expect(tokensMatch(generateShareToken(), stored)).toBe(false);
  });

  test("sharing turned off matches nothing", () => {
    // NULL in the column must not equal an empty or missing path segment.
    expect(tokensMatch(stored, null)).toBe(false);
    expect(tokensMatch("", null)).toBe(false);
    expect(tokensMatch(undefined, undefined)).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
  });

  test("a value that is not shaped like a token is refused before comparing", () => {
    expect(tokensMatch("short", "short")).toBe(false);
    expect(tokensMatch(`${stored}extra`, stored)).toBe(false);
  });
});

describe("isPublicApiPath", () => {
  const token = generateShareToken();

  test("the share feed is public", () => {
    expect(isPublicApiPath(`/api/share/${token}/usage`)).toBe(true);
  });

  test("the route that creates and revokes the link is not", () => {
    // It is how sharing is turned on and off, so it must meet the session gate.
    expect(isPublicApiPath("/api/share")).toBe(false);
    expect(isPublicApiPath("/api/share/")).toBe(false);
  });

  test("a route that merely starts with the same letters is not", () => {
    // What a bare startsWith("/api/share/") would have waved through.
    expect(isPublicApiPath(`/api/shareX/${token}/usage`)).toBe(false);
    expect(isPublicApiPath(`/api/share-admin/${token}/usage`)).toBe(false);
  });

  test("nothing else under the token is public", () => {
    expect(isPublicApiPath(`/api/share/${token}`)).toBe(false);
    expect(isPublicApiPath(`/api/share/${token}/settings`)).toBe(false);
    expect(isPublicApiPath(`/api/share/${token}/usage/history`)).toBe(false);
  });

  test("a segment that is not shaped like a token is not a token", () => {
    expect(isPublicApiPath("/api/share/short/usage")).toBe(false);
    expect(isPublicApiPath(`/api/share/${token}x/usage`)).toBe(false);
    expect(isPublicApiPath(`/api/share/${token.slice(0, 42)}./usage`)).toBe(false);
  });

  test("no other API route is public", () => {
    expect(isPublicApiPath("/api/settings")).toBe(false);
    expect(isPublicApiPath("/")).toBe(false);
    expect(isPublicApiPath("")).toBe(false);
  });
});
