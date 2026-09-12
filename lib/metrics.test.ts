import { describe, expect, test } from "vitest";
import { renderPrometheus, type MetricsSample } from "@/lib/metrics";

const sample: MetricsSample = {
  today_used_bytes: 4_200_000_000,
  today_quota_bytes: 8_000_000_000,
  today_percent: 52.5,
  window_active: true,
  cycle_used_bytes: 187_000_000_000,
  cycle_cap_bytes: 600_000_000_000,
  cycle_percent: 31.1667,
  last_reading_age_seconds: 27,
  link_up: true,
  session_uptime_seconds: 42_000,
  polling_enabled: true,
};

describe("renderPrometheus", () => {
  test("writes HELP, TYPE and a value line for each gauge", () => {
    const text = renderPrometheus(sample);
    expect(text).toContain("# HELP quota_monitor_today_used_bytes Traffic inside today's quota window in bytes\n");
    expect(text).toContain("# TYPE quota_monitor_today_used_bytes gauge\n");
    expect(text).toContain("quota_monitor_today_used_bytes 4200000000\n");
    expect(text).toContain("quota_monitor_cycle_percent 31.1667\n");
  });

  test("booleans become 1 and 0", () => {
    expect(renderPrometheus(sample)).toContain("quota_monitor_link_up 1\n");
    expect(renderPrometheus({ ...sample, polling_enabled: false })).toContain("quota_monitor_polling_enabled 0\n");
  });

  test("a null figure is left out entirely, HELP and TYPE included", () => {
    const text = renderPrometheus({ ...sample, link_up: null, last_reading_age_seconds: null, session_uptime_seconds: null });
    expect(text).not.toContain("quota_monitor_link_up");
    expect(text).not.toContain("quota_monitor_last_reading_age_seconds");
    expect(text).not.toContain("quota_monitor_session_uptime_seconds");
  });

  test("ends with exactly one newline and has no blank lines", () => {
    const text = renderPrometheus(sample);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text).not.toContain("\n\n");
  });

  test("every metric name carries the prefix", () => {
    const names = renderPrometheus(sample)
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(" ")[0]);
    expect(names.length).toBe(11);
    for (const name of names) expect(name.startsWith("quota_monitor_")).toBe(true);
  });
});
