import { describe, expect, test } from "vitest";
import { renderAlertEmail, subjectLine, type AlertReport } from "@/lib/email-template";

/** A breach with every section present. Tests narrow it rather than build up. */
function report(overrides: Partial<AlertReport> = {}): AlertReport {
  return {
    kind: "alert",
    locale: "en",
    generated_at: "2026-09-11T20:05:00.000Z",
    date: "2026-09-11",
    timezone: "Asia/Beirut",
    window: { start: "09:00", end: "23:59" },
    app_url: null,
    threshold: null,
    today: {
      used_bytes: 12.4e9,
      quota_bytes: 10e9,
      percent: 124,
      over_bytes: 2.4e9,
      tx_bytes: 2.3e9,
      rx_bytes: 10.1e9,
      peak_bytes_per_second: 48e6,
      avg_bytes_per_second: 2.1e6,
      peak_hour: 21,
      peak_hour_bytes: 3.6e9,
    },
    cycle: {
      used_bytes: 187e9,
      cap_bytes: 500e9,
      percent: 37.4,
      projected_bytes: 402e9,
      projected_percent: 80.4,
      days_elapsed: 14,
      days_total: 30,
      days_remaining: 16,
      daily_budget_bytes: 19.5e9,
      daily_average_bytes: 13.3e9,
      over: false,
    },
    week: {
      days: [
        { day: "2026-09-09", label: "Wed", used_bytes: 4.1e9, over: false },
        { day: "2026-09-10", label: "Thu", used_bytes: 12.9e9, over: true },
        { day: "2026-09-11", label: "Fri", used_bytes: 12.4e9, over: true },
      ],
      quota_bytes: 10e9,
      days_measured: 3,
      days_over: 2,
      compliance_rate: 33.333,
      average_bytes: 9.8e9,
      worst: { day: "2026-09-10", label: "Thu", used_bytes: 12.9e9, over: true },
    },
    connection: {
      sessions: 6,
      drops: 5,
      availability: 99.2,
      uptime_seconds: 594_000,
      longest_seconds: 201_600,
      mtbf_seconds: 118_800,
    },
    ...overrides,
  };
}

describe("subjectLine", () => {
  test("says exceeded, with the figures, when usage is over quota", () => {
    expect(subjectLine(report())).toBe(
      "Internet quota exceeded: 12.40 GB of 10.00 GB (124%) on 2026-09-11",
    );
  });

  test("does not claim a breach when usage is under quota", () => {
    const under = report({
      today: { ...report().today, used_bytes: 4e9, percent: 40, over_bytes: 0 },
    });
    expect(subjectLine(under)).toContain("Internet quota report");
    expect(subjectLine(under)).not.toContain("exceeded");
  });

  test("marks a test send so it cannot be mistaken for a real alert", () => {
    expect(subjectLine(report({ kind: "test" }))).toMatch(/^\[Test\] /);
  });
});

describe("renderAlertEmail", () => {
  test("leads with the figure that tripped the alert", () => {
    const { html } = renderAlertEmail(report());
    expect(html).toContain("12.40 GB");
    expect(html).toContain("QUOTA EXCEEDED".toLowerCase());
    expect(html).toContain("Quota exceeded");
  });

  test("carries every section when the report is complete", () => {
    const { html } = renderAlertEmail(report());
    for (const heading of [
      "Today&#039;s traffic",
      "Billing cycle",
      "Last 7 days",
      "Connection health",
    ]) {
      // The apostrophe is not escaped by esc(), so match the plain form too.
      expect(html.includes(heading) || html.includes(heading.replace("&#039;", "'"))).toBe(true);
    }
  });

  test("drops a section rather than rendering an empty one", () => {
    const { html, text } = renderAlertEmail(
      report({ cycle: null, week: null, connection: null }),
    );
    expect(html).not.toContain("Billing cycle");
    expect(html).not.toContain("Connection health");
    expect(text).not.toContain("BILLING CYCLE");
    // The headline survives, which is the whole point of the sections being optional.
    expect(html).toContain("12.40 GB");
  });

  test("clamps the meter at full rather than overflowing the table", () => {
    // 124% of quota: the bar fills, and no cell is ever wider than its table.
    const { html } = renderAlertEmail(report());
    expect(html).toContain('width="100%" style="width:100%;height:10px');
    const widths = [...html.matchAll(/width="([\d.]+)%"/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(0);
    expect(Math.max(...widths)).toBeLessThanOrEqual(100);
  });

  test("draws one bar per measured day and tints the days over quota", () => {
    const { html } = renderAlertEmail(report());
    const chart = html.slice(html.indexOf("Last 7 days"));
    // Three days, two of them over: two red bars, one blue.
    expect(chart.match(/background:#d03b3b;border-radius:4px/g)).toHaveLength(2);
    expect(chart.match(/background:#2a78d6;border-radius:4px/g)).toHaveLength(1);
  });

  test("escapes values that come from settings", () => {
    const { html } = renderAlertEmail(report({ timezone: '"><script>x</script>' }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("shows remaining quota instead of an overage when under the limit", () => {
    const under = report({
      today: { ...report().today, used_bytes: 4e9, percent: 40, over_bytes: 0 },
    });
    const { html } = renderAlertEmail(under);
    expect(html).toContain("Remaining today");
    expect(html).not.toContain("Over quota by");
  });

  test("gives the plain-text body the same figures as the HTML", () => {
    const { text } = renderAlertEmail(report());
    expect(text).toContain("Used          12.40 GB of 10.00 GB (124%)");
    expect(text).toContain("Over by       2.40 GB");
    expect(text).toContain("Projected     402.00 GB (80% of cap)");
    expect(text).toContain("2 of 3 days over quota");
    expect(text).toContain("Availability  99.2%");
    expect(text).toContain("This is the only alert you will receive for today.");
  });

  test("adds the dashboard button only when a URL is configured", () => {
    expect(renderAlertEmail(report()).html).not.toContain("Open the dashboard");
    const linked = renderAlertEmail(report({ app_url: "https://monitor.example.com" }));
    expect(linked.html).toContain("Open the dashboard");
    expect(linked.html).toContain('href="https://monitor.example.com"');
    expect(linked.text).toContain("Dashboard: https://monitor.example.com");
  });

  test("banners a test send in both bodies", () => {
    const { html, text } = renderAlertEmail(report({ kind: "test" }));
    expect(html).toContain("Test preview.");
    expect(html).not.toContain("This is the only alert you will receive for today.");
    expect(text).toContain("TEST PREVIEW");
  });

  test("omits the busiest hour when no hourly data survived", () => {
    const { html, text } = renderAlertEmail(
      report({ today: { ...report().today, peak_hour: null, peak_hour_bytes: 0 } }),
    );
    expect(html).not.toContain("Busiest hour");
    expect(text).not.toContain("Busiest hour");
  });
});

describe("Arabic", () => {
  const arabic = () => report({ locale: "ar" as const });

  test("writes the subject in Arabic, keeping the figures as measured", () => {
    const subject = subjectLine(arabic());
    expect(subject).toContain("تم تجاوز حصة الإنترنت");
    // The numbers and their units are the same ones the database holds.
    expect(subject).toContain("12.40 GB");
    expect(subject).toContain("10.00 GB");
    expect(subject).not.toMatch(/[٠-٩]/);
  });

  test("marks the document right-to-left so a mail client lays it out correctly", () => {
    const { html } = renderAlertEmail(arabic());
    expect(html).toContain('<html lang="ar" dir="rtl">');
    // A label ends on the left of its row once the row runs the other way.
    expect(html).toContain('align="left"');
  });

  test("keeps the week chart in calendar order whichever way the page runs", () => {
    // Reversing a time axis would state something different about the week.
    const { html } = renderAlertEmail(arabic());
    expect(html).toContain('<table role="presentation" dir="ltr"');
  });

  test("leaves no English prose in either body", () => {
    const { html, text } = renderAlertEmail(arabic());
    for (const english of [
      "Quota exceeded",
      "Billing cycle",
      "Connection health",
      "This is the only alert you will receive for today.",
    ]) {
      expect(html).not.toContain(english);
      expect(text).not.toContain(english);
    }
    expect(text).toContain("دورة الفوترة");
  });

  test("gives durations Arabic suffixes", () => {
    const { text } = renderAlertEmail(arabic());
    // 201600s is 2 days 8 hours; the units are words, so they translate.
    expect(text).toContain("2ي 8س 0د");
  });

  test("still renders when a language is chosen and sections are missing", () => {
    const { html } = renderAlertEmail(
      report({ locale: "ar" as const, cycle: null, week: null, connection: null }),
    );
    expect(html).toContain("12.40 GB");
    expect(html).not.toContain("دورة الفوترة");
  });
});

describe("threshold marks", () => {
  const at80 = () =>
    report({
      threshold: 80,
      today: {
        used_bytes: 8.2e9,
        quota_bytes: 10e9,
        percent: 82,
        over_bytes: 0,
        tx_bytes: 1.1e9,
        rx_bytes: 7.1e9,
        peak_bytes_per_second: 20e6,
        avg_bytes_per_second: 1.2e6,
        peak_hour: 19,
        peak_hour_bytes: 2.1e9,
      },
    });

  test("subject names the mark, not a breach", () => {
    expect(subjectLine(at80())).toBe("Internet quota at 80%: 8.20 GB of 10.00 GB on 2026-09-11");
  });

  test("intro and footer speak of a warning, and promise the next mark", () => {
    const { text, html } = renderAlertEmail(at80());
    expect(text).toContain("Your home internet usage has reached 80% of the daily quota.");
    expect(text).toContain("You will be told again at the next mark.");
    expect(html).toContain("Quota at 80%");
    expect(text).not.toContain("This is the only alert you will receive for today.");
  });

  test("a mark of 100 reads as the exceeded alert", () => {
    const { text } = renderAlertEmail(report({ threshold: 100 }));
    expect(subjectLine(report({ threshold: 100 }))).toContain("Internet quota exceeded");
    expect(text).toContain("This is the only alert you will receive for today.");
  });

  test("a mark of 100 reads as exceeded even at the exact boundary, not just when over", () => {
    // used_bytes === quota_bytes: not strictly "over", but the 100 mark itself
    // is defined to always read as the breach alert.
    const atBoundary = report({
      threshold: 100,
      today: { ...report().today, used_bytes: 10e9, quota_bytes: 10e9, percent: 100, over_bytes: 0 },
    });
    expect(subjectLine(atBoundary)).toContain("Internet quota exceeded");
    expect(subjectLine(atBoundary)).not.toContain("Internet quota report");
    const { text, html } = renderAlertEmail(atBoundary);
    expect(text).toContain("Your home internet usage has exceeded the daily quota.");
    expect(text).not.toContain("Daily quota report.");
    expect(html).toContain("Quota exceeded");
  });
});
