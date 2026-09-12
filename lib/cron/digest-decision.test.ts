import { describe, expect, test } from "vitest";
import { FAILED_SEND_COOLDOWN_MS } from "@/lib/alerts/dispatch";
import { effectiveLastSentAt, type DigestAlertRow } from "@/lib/cron/digest-decision";

const NOW = new Date("2026-09-14T12:00:00Z");

function row(status: DigestAlertRow["status"], created_at: Date): DigestAlertRow {
  return { status, created_at };
}

describe("effectiveLastSentAt", () => {
  test("never sent before: null", () => {
    expect(effectiveLastSentAt(null, NOW)).toBeNull();
  });

  test("a sent row blocks, however long ago", () => {
    const sentAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60_000); // a week ago
    expect(effectiveLastSentAt(row("sent", sentAt), NOW)).toEqual(sentAt);
  });

  test("a failed row just inside the cooldown blocks", () => {
    const failedAt = new Date(NOW.getTime() - (FAILED_SEND_COOLDOWN_MS - 1));
    expect(effectiveLastSentAt(row("failed", failedAt), NOW)).toEqual(failedAt);
  });

  test("a failed row exactly at the cooldown boundary releases", () => {
    const failedAt = new Date(NOW.getTime() - FAILED_SEND_COOLDOWN_MS);
    expect(effectiveLastSentAt(row("failed", failedAt), NOW)).toBeNull();
  });

  test("a failed row past the cooldown releases", () => {
    const failedAt = new Date(NOW.getTime() - (FAILED_SEND_COOLDOWN_MS + 1));
    expect(effectiveLastSentAt(row("failed", failedAt), NOW)).toBeNull();
  });

  test("a skipped row never blocks, however recent", () => {
    expect(effectiveLastSentAt(row("skipped", NOW), NOW)).toBeNull();
  });
});
