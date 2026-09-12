import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the password it hashed and rejects another", async () => {
    const stored = await hashPassword("admin123");
    expect(stored.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("admin123", stored)).toBe(true);
    expect(await verifyPassword("admin124", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently twice", async () => {
    const a = await hashPassword("admin123");
    const b = await hashPassword("admin123");
    expect(a).not.toBe(b);
  });

  it("is deterministic for a given salt, which is what the schema seed relies on", async () => {
    const salt = Buffer.from("quota-monitor-seed", "utf8");
    const a = await hashPassword("admin123", salt);
    const b = await hashPassword("admin123", salt);
    expect(a).toBe(b);
  });

  it("returns false for a malformed stored value instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$whatever")).toBe(false);
    expect(await verifyPassword("x", "scrypt$0$8$1$AA$AA")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$AA$")).toBe(false);
  });
});
