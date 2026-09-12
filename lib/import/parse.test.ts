import { describe, expect, test } from "vitest";
import { dedupeRows, MAX_ERRORS, parseReadingsCsv, parseReadingsJson, type ImportRow } from "@/lib/import/parse";

const HEADER = "recorded_at,tx_bytes,rx_bytes,total_bytes,interface_name";

describe("parseReadingsCsv", () => {
  test("reads the export format back", () => {
    const text = `${HEADER}\n2026-09-01T10:00:00.000Z,100,200,300,pppoe-out1\n2026-09-01T10:00:30.000Z,150,260,410,pppoe-out1\n`;
    const { rows, errors, rejected } = parseReadingsCsv(text);
    expect(errors).toEqual([]);
    expect(rejected).toBe(0);
    expect(rows).toEqual([
      { recorded_at: new Date("2026-09-01T10:00:00.000Z"), tx_bytes: 100, rx_bytes: 200, interface_name: "pppoe-out1" },
      { recorded_at: new Date("2026-09-01T10:00:30.000Z"), tx_bytes: 150, rx_bytes: 260, interface_name: "pppoe-out1" },
    ]);
  });

  test("finds columns by name whatever their order, and ignores total_bytes", () => {
    const text = "rx_bytes,recorded_at,tx_bytes\n5,2026-09-01T10:00:00Z,7\n";
    const { rows } = parseReadingsCsv(text);
    expect(rows).toEqual([
      { recorded_at: new Date("2026-09-01T10:00:00Z"), tx_bytes: 7, rx_bytes: 5, interface_name: null },
    ]);
  });

  test("an older export without interface_name yields null", () => {
    const text = "recorded_at,tx_bytes,rx_bytes,total_bytes\n2026-09-01T10:00:00Z,1,2,3\n";
    expect(parseReadingsCsv(text).rows[0].interface_name).toBeNull();
  });

  test("tolerates CRLF, blank lines and a UTF-8 BOM", () => {
    const text = `﻿${HEADER}\r\n2026-09-01T10:00:00Z,1,2,3,pppoe-out1\r\n\r\n`;
    const { rows, errors } = parseReadingsCsv(text);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  test("unquotes an interface name with a comma in it", () => {
    const text = `${HEADER}\n2026-09-01T10:00:00Z,1,2,3,"wan, primary"\n`;
    expect(parseReadingsCsv(text).rows[0].interface_name).toBe("wan, primary");
  });

  test("a missing required header is the only error", () => {
    const { rows, errors, rejected } = parseReadingsCsv("recorded_at,tx_bytes\n2026-09-01T10:00:00Z,1\n");
    expect(rows).toEqual([]);
    expect(rejected).toBe(0);
    expect(errors).toEqual(["header: missing column rx_bytes"]);
  });

  test("rejects a bad date and negative or fractional bytes, naming the line", () => {
    const text = `${HEADER}\nnot-a-date,1,2,3,x\n2026-09-01T10:00:00Z,-1,2,1,x\n2026-09-01T10:00:00Z,1,2.5,3.5,x\n2026-09-01T10:00:00Z,1,2,3,x\n`;
    const { rows, errors, rejected } = parseReadingsCsv(text);
    expect(rows).toHaveLength(1);
    expect(rejected).toBe(3);
    expect(errors).toEqual([
      'line 2: recorded_at "not-a-date" is not a date',
      'line 3: tx_bytes "-1" is not a whole number of bytes',
      'line 4: rx_bytes "2.5" is not a whole number of bytes',
    ]);
  });

  test("caps the messages but keeps counting rejections", () => {
    const bad = Array.from({ length: MAX_ERRORS + 5 }, () => "x,1,2,3,x").join("\n");
    const { errors, rejected } = parseReadingsCsv(`${HEADER}\n${bad}\n`);
    expect(errors).toHaveLength(MAX_ERRORS);
    expect(rejected).toBe(MAX_ERRORS + 5);
  });
});

describe("parseReadingsJson", () => {
  test("reads the export format back", () => {
    const text = JSON.stringify([
      { recorded_at: "2026-09-01T10:00:00.000Z", tx_bytes: 1, rx_bytes: 2, total_bytes: 3, interface_name: "pppoe-out1" },
    ]);
    expect(parseReadingsJson(text)).toEqual({
      rows: [{ recorded_at: new Date("2026-09-01T10:00:00.000Z"), tx_bytes: 1, rx_bytes: 2, interface_name: "pppoe-out1" }],
      errors: [],
      rejected: 0,
    });
  });

  test("accepts numbers written as strings and a missing interface", () => {
    const text = JSON.stringify([{ recorded_at: "2026-09-01T10:00:00Z", tx_bytes: "10", rx_bytes: "20" }]);
    expect(parseReadingsJson(text).rows[0]).toEqual({
      recorded_at: new Date("2026-09-01T10:00:00Z"),
      tx_bytes: 10,
      rx_bytes: 20,
      interface_name: null,
    });
  });

  test("anything but an array is one error", () => {
    expect(parseReadingsJson('{"rows":[]}')).toEqual({ rows: [], errors: ["body: expected a JSON array"], rejected: 0 });
    expect(parseReadingsJson("nope")).toEqual({ rows: [], errors: ["body: not valid JSON"], rejected: 0 });
  });

  test("a bad item names its index and the rest still load", () => {
    const text = JSON.stringify([
      { recorded_at: "2026-09-01T10:00:00Z", tx_bytes: 1, rx_bytes: 2 },
      "not an object",
      { recorded_at: "2026-09-01T10:00:00Z", tx_bytes: 1 },
    ]);
    const { rows, errors, rejected } = parseReadingsJson(text);
    expect(rows).toHaveLength(1);
    expect(rejected).toBe(2);
    expect(errors).toEqual(["item 2: not an object", 'item 3: rx_bytes "undefined" is not a whole number of bytes']);
  });
});

describe("dedupeRows", () => {
  const row = (at: string, interface_name: string | null): ImportRow => ({
    recorded_at: new Date(at),
    tx_bytes: 1,
    rx_bytes: 2,
    interface_name,
  });

  test("keeps the first of two readings of the same interface at the same instant", () => {
    const rows = [row("2026-09-01T10:00:00Z", "ether1"), row("2026-09-01T10:00:00Z", "ether1")];
    expect(dedupeRows(rows, "pppoe-out1")).toEqual([rows[0]]);
  });

  test("keeps both when the same instant is two different interfaces", () => {
    const rows = [row("2026-09-01T10:00:00Z", "ether1"), row("2026-09-01T10:00:00Z", "ether2")];
    expect(dedupeRows(rows, "pppoe-out1")).toHaveLength(2);
  });

  test("a nameless row collides with a row already carrying the configured name", () => {
    // The nameless row will be stored under the fallback, so leaving both in
    // would insert the same reading twice in one file.
    const rows = [row("2026-09-01T10:00:00Z", null), row("2026-09-01T10:00:00Z", "pppoe-out1")];
    expect(dedupeRows(rows, "pppoe-out1")).toEqual([rows[0]]);
  });

  test("leaves the parsed null in place for the caller's existence test", () => {
    const rows = [row("2026-09-01T10:00:00Z", null)];
    expect(dedupeRows(rows, "pppoe-out1")[0].interface_name).toBeNull();
  });
});
