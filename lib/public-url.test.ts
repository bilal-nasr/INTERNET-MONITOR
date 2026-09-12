import { afterEach, describe, expect, test } from "vitest";
import { publicBaseUrl, publicBaseUrlFromHeaders } from "@/lib/public-url";

const APP_URL = process.env.APP_URL;
afterEach(() => {
  if (APP_URL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = APP_URL;
});

function headers(map: Record<string, string>) {
  return (name: string) => map[name] ?? null;
}

describe("publicBaseUrlFromHeaders", () => {
  test("prefers APP_URL and drops its trailing slashes", () => {
    process.env.APP_URL = "https://monitor.example.com//";
    expect(publicBaseUrlFromHeaders(headers({ host: "192.168.88.9:3000" }))).toBe("https://monitor.example.com");
  });

  test("falls back to the host header when APP_URL is blank", () => {
    process.env.APP_URL = "  ";
    expect(publicBaseUrlFromHeaders(headers({ host: "192.168.88.9:3000" }))).toBe("http://192.168.88.9:3000");
  });

  test("honours the first entry of the forwarded headers", () => {
    delete process.env.APP_URL;
    const get = headers({
      "x-forwarded-proto": "https, http",
      "x-forwarded-host": "monitor.example.com, inner",
      host: "inner:3000",
    });
    expect(publicBaseUrlFromHeaders(get)).toBe("https://monitor.example.com");
  });

  test("uses the fallback origin when nothing was forwarded", () => {
    delete process.env.APP_URL;
    expect(publicBaseUrlFromHeaders(headers({}), "https://host.local:8443")).toBe("https://host.local:8443");
  });

  test("defaults to localhost when no fallback origin is given", () => {
    delete process.env.APP_URL;
    expect(publicBaseUrlFromHeaders(headers({}))).toBe("http://localhost:3000");
  });
});

describe("publicBaseUrl", () => {
  test("reads the request's own headers and origin", () => {
    delete process.env.APP_URL;
    const request = new Request("http://inner:3000/api/auth/forgot", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "monitor.example.com" },
    });
    expect(publicBaseUrl(request)).toBe("https://monitor.example.com");
  });

  test("falls back to the url the request arrived on", () => {
    delete process.env.APP_URL;
    expect(publicBaseUrl(new Request("https://monitor.example.com/api/auth/forgot"))).toBe(
      "https://monitor.example.com",
    );
  });
});
