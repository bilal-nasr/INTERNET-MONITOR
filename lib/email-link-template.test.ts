import { describe, expect, test } from "vitest";
import { renderLinkEmail, type LinkReport } from "@/lib/email-link-template";

function report(overrides: Partial<LinkReport> = {}): LinkReport {
  return {
    kind: "stale",
    locale: "en",
    last_reading_at: "2026-09-14T08:12:00.000Z", // 11:12 in Beirut
    silent_seconds: 1500, // 25m 00s
    timezone: "Asia/Beirut",
    app_url: null,
    ...overrides,
  };
}

describe("renderLinkEmail", () => {
  test("stale: subject carries the silence, body carries the last reading", () => {
    const { subject, text, html } = renderLinkEmail(report());
    expect(subject).toBe("No data from the router for 25m 00s");
    expect(text).toContain("11:12, 14 Sep (Asia/Beirut)");
    expect(text).toContain("25m 00s");
    expect(html).toContain("The router has gone quiet");
    expect(html).toContain("quota-push");
  });

  test("stale with no reading ever says so instead of a time", () => {
    const { text } = renderLinkEmail(report({ last_reading_at: null }));
    expect(text).toContain("No reading has ever been received");
    expect(text).not.toContain("(Asia/Beirut)");
  });

  test("recovered: different subject, heading and footer", () => {
    const { subject, text, html } = renderLinkEmail(report({ kind: "recovered", silent_seconds: 3720 }));
    expect(subject).toBe("The router is reporting again");
    expect(text).toContain("1h 02m");
    expect(html).toContain("Readings have resumed");
    expect(text).toContain("No further mail unless");
    expect(html).not.toContain("usually means one of");
  });

  test("dashboard link appears only when configured", () => {
    expect(renderLinkEmail(report()).html).not.toContain("Open the dashboard");
    const withUrl = renderLinkEmail(report({ app_url: "https://netmonitor.example" }));
    expect(withUrl.html).toContain('href="https://netmonitor.example"');
    expect(withUrl.text).toContain("Dashboard: https://netmonitor.example");
  });

  test("Arabic is right to left and has no English prose", () => {
    const { html, text } = renderLinkEmail(report({ locale: "ar" }));
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain("gone quiet");
    expect(text).toContain("توقف الراوتر عن الإبلاغ");
    // Durations take the Arabic suffixes.
    expect(text).toContain("25د 00ث");
  });

  test("escapes the timezone and url, which come from settings and the environment", () => {
    const { html } = renderLinkEmail(report({ timezone: "<script>", app_url: "https://x/?a=1&b=2" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("https://x/?a=1&amp;b=2");
  });
});
