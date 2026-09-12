import { describe, expect, test } from "vitest";
import { escapeHtml, formatBytes, formatRate, quotaBytes } from "@/lib/format";

describe("formatRate", () => {
  test("writes bits per second in decimal units", () => {
    expect(formatRate(12)).toBe("96 bit/s");
    expect(formatRate(80_000)).toBe("640 kbit/s");
    expect(formatRate(1_550_000)).toBe("12.4 Mbit/s");
    expect(formatRate(156_250_000)).toBe("1.25 Gbit/s");
  });

  test("rounds instead of truncating", () => {
    // 1 562 500 B/s is 12.5 Mbit/s exactly; 1 568 750 is 12.55, shown as 12.6.
    expect(formatRate(1_562_500)).toBe("12.5 Mbit/s");
    expect(formatRate(1_568_750)).toBe("12.6 Mbit/s");
  });

  test("never shows a negative or a non-number", () => {
    expect(formatRate(-5)).toBe("0 bit/s");
    expect(formatRate(Number.NaN)).toBe("-");
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

describe("existing formatters keep working", () => {
  test("formatBytes and quotaBytes", () => {
    expect(formatBytes(1.5e9)).toBe("1.50 GB");
    expect(quotaBytes(8)).toBe(8_000_000_000);
  });
});

describe("escapeHtml", () => {
  test("escapes every character that can break out of markup", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  test("escapes the apostrophe, which three of the four old copies missed", () => {
    // The reason the four templates were folded into one helper: a value with
    // an apostrophe used to survive into an attribute written with single
    // quotes, and "Today's traffic" rendered unescaped in the alert mail.
    expect(escapeHtml("Today's traffic")).toBe("Today&#39;s traffic");
  });

  test("escapes the ampersand once, not twice", () => {
    expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  test("leaves a value with nothing to escape untouched", () => {
    expect(escapeHtml("pppoe-out1")).toBe("pppoe-out1");
    expect(escapeHtml("")).toBe("");
  });
});
