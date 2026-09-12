import { describe, expect, test } from "vitest";
import { describeUserAgent } from "@/lib/auth/user-agent";

describe("describeUserAgent", () => {
  test("Chrome on Windows", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      ),
    ).toEqual({ browser: "chrome", os: "windows" });
  });

  test("Edge is not reported as Chrome", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
      ),
    ).toEqual({ browser: "edge", os: "windows" });
  });

  test("Safari on iPhone", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ browser: "safari", os: "ios" });
  });

  test("Chrome on Android", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
      ),
    ).toEqual({ browser: "chrome", os: "android" });
  });

  test("Firefox on macOS", () => {
    expect(
      describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:129.0) Gecko/20100101 Firefox/129.0"),
    ).toEqual({ browser: "firefox", os: "macos" });
  });

  test("iPad is told apart from iPhone", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ browser: "safari", os: "ipad" });
  });

  test("Linux desktop", () => {
    expect(
      describeUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"),
    ).toEqual({ browser: "chrome", os: "linux" });
  });

  test("nothing known yields unknown on both sides", () => {
    expect(describeUserAgent(null)).toEqual({ browser: "unknown", os: "unknown" });
    expect(describeUserAgent("curl/8.9.1")).toEqual({ browser: "unknown", os: "unknown" });
  });
});
