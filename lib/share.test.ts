import { describe, expect, test } from "vitest";
import { generateShareToken, tokensMatch } from "@/lib/share";

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
