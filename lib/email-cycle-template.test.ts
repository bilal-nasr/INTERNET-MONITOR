import { describe, expect, test } from "vitest";
import { cycleSubject, renderCycleEmail, type CycleReport } from "@/lib/email-cycle-template";

function report(overrides: Partial<CycleReport> = {}): CycleReport {
  return {
    kind: "threshold",
    locale: "en",
    generated_at: "2026-09-20T10:00:00.000Z",
    timezone: "Asia/Beirut",
    threshold: 80,
    app_url: "https://netmonitor.example",
    cycle: {
      start: "2026-09-05",
      end: "2026-10-05",
      used_bytes: 486e9,
      cap_bytes: 600e9,
      percent: 81,
      projected_bytes: 972e9,
      projected_percent: 162,
      days_elapsed: 15,
      days_total: 30,
      days_remaining: 15,
      daily_budget_bytes: 7.6e9,
      daily_average_bytes: 32.4e9,
      over: false,
    },
    ...overrides,
  };
}

describe("cycleSubject", () => {
  test("names the mark", () => {
    expect(cycleSubject(report())).toBe("Monthly cap at 80%: 486.00 GB of 600.00 GB used");
  });

  test("says exceeded at 100", () => {
    expect(cycleSubject(report({ threshold: 100, cycle: { ...report().cycle, over: true, used_bytes: 601e9, percent: 100.2 } }))).toBe(
      "Monthly cap exceeded: 601.00 GB of 600.00 GB used",
    );
  });

  test("describes the projection for a pace warning", () => {
    expect(cycleSubject(report({ kind: "pace", threshold: null }))).toBe(
      "On course to exceed the monthly cap: 972.00 GB projected of 600.00 GB",
    );
  });
});

describe("renderCycleEmail", () => {
  test("carries the cycle figures in both bodies", () => {
    const { text, html } = renderCycleEmail(report());
    for (const body of [text, html]) {
      expect(body).toContain("486.00 GB of 600.00 GB (81%)");
      expect(body).toContain("972.00 GB (162% of cap)");
      expect(body).toContain("day 15 of 30, 15 left");
      // The cycle ends at midnight on the 5th, so the last day it covers is the 4th.
      expect(body).toContain("2026-09-05 to 2026-10-04 (Asia/Beirut)");
      expect(body).toContain("32.40 GB");
      expect(body).toContain("7.60 GB");
    }
    expect(html).toContain('href="https://netmonitor.example"');
    expect(text).toContain("Dashboard: https://netmonitor.example");
  });

  test("omits the dashboard link without an app url", () => {
    const { text, html } = renderCycleEmail(report({ app_url: null }));
    expect(html).not.toContain("<a ");
    expect(text).not.toContain("Dashboard:");
  });

  test("promises the next mark for an ordinary threshold mail", () => {
    const { text } = renderCycleEmail(report());
    expect(text).toContain(
      "You will be told again at the next mark, and once more if the cap is exceeded.",
    );
  });

  test("says no further cap mail is due once the cap is exceeded", () => {
    const { text } = renderCycleEmail(
      report({ threshold: 100, cycle: { ...report().cycle, over: true, used_bytes: 601e9, percent: 100.2 } }),
    );
    expect(text).toContain("The cap for this cycle has been passed. No further cap mail is due this cycle.");
    expect(text).not.toContain("You will be told again at the next mark");
  });

  test("renders Arabic right to left with no English prose", () => {
    const { html, text } = renderCycleEmail(report({ locale: "ar" }));
    expect(html).toContain('dir="rtl"');
    expect(text).not.toContain("Monthly cap");
    expect(text).toContain("السقف الشهري");
  });

  test("escapes HTML in values", () => {
    const { html } = renderCycleEmail(report({ timezone: "<script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
