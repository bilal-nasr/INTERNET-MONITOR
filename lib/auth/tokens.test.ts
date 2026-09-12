import { describe, expect, it } from "vitest";
import { generateToken, hashToken, looksLikeToken } from "./tokens";

describe("tokens", () => {
  it("generates 43-character url-safe tokens that differ", () => {
    const a = generateToken();
    const b = generateToken();
    expect(looksLikeToken(a)).toBe(true);
    expect(looksLikeToken(b)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("hashes deterministically to a 64-hex sha256", () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toBe(hashToken(generateToken()));
  });

  it("rejects values that are not shaped like a token", () => {
    expect(looksLikeToken("")).toBe(false);
    expect(looksLikeToken("abc")).toBe(false);
    expect(looksLikeToken(42)).toBe(false);
    expect(looksLikeToken("a".repeat(43) + "!")).toBe(false);
    expect(looksLikeToken("a".repeat(44))).toBe(false);
  });
});
