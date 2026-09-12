import { describe, expect, test } from "vitest";
import { decodeAuthContext, encodeAuthContext } from "@/lib/auth/context-header";

const ctx = { sessionId: 7, user: { id: 3, username: "bilal", email: "bïlal@example.com" } };

describe("auth context header", () => {
  test("round-trips a context, including non-ASCII text", () => {
    expect(decodeAuthContext(encodeAuthContext(ctx))).toEqual(ctx);
  });

  test("round-trips a user without an email", () => {
    const anon = { sessionId: 1, user: { id: 2, username: "x", email: null } };
    expect(decodeAuthContext(encodeAuthContext(anon))).toEqual(anon);
  });

  test("encodes to a value a request header can carry", () => {
    expect(encodeAuthContext(ctx)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("returns null for a missing header", () => {
    expect(decodeAuthContext(null)).toBeNull();
    expect(decodeAuthContext(undefined)).toBeNull();
  });

  test("returns null for a value that is not ours", () => {
    expect(decodeAuthContext("not base64 json!")).toBeNull();
    expect(decodeAuthContext(Buffer.from('{"sessionId":"7"}').toString("base64url"))).toBeNull();
    expect(decodeAuthContext(Buffer.from('{"sessionId":7,"user":{"id":1}}').toString("base64url"))).toBeNull();
  });
});
