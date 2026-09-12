/**
 * Reading the export format back in.
 *
 * Both parsers accept exactly what /api/export writes (Task 4 of the data-ops
 * plan) and older exports that lacked `interface_name`. They never throw on a
 * bad row: the row is counted in `rejected`, described in `errors` while there
 * is room, and the rest of the file still loads. Pure, so the rules are
 * testable without a database.
 */

export interface ImportRow {
  recorded_at: Date;
  tx_bytes: number;
  rx_bytes: number;
  /** Null when the file did not say; the route fills in the configured interface. */
  interface_name: string | null;
}

export interface ParseResult {
  rows: ImportRow[];
  /** At most MAX_ERRORS messages; `rejected` keeps the full count. */
  errors: string[];
  rejected: number;
}

export const MAX_ERRORS = 20;

const REQUIRED = ["recorded_at", "tx_bytes", "rx_bytes"] as const;

type Fields = Record<string, unknown>;

/** One row's fields to a reading, or the first reason it cannot be one. */
function toImportRow(fields: Fields): ImportRow | string {
  const stamp = String(fields.recorded_at ?? "");
  const recorded_at = new Date(stamp);
  if (!stamp || Number.isNaN(recorded_at.getTime())) {
    return `recorded_at "${stamp}" is not a date`;
  }
  const bytes: number[] = [];
  for (const key of ["tx_bytes", "rx_bytes"] as const) {
    const raw = fields[key];
    const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    if (
      String(raw ?? "").trim() === "" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > Number.MAX_SAFE_INTEGER
    ) {
      return `${key} "${String(raw)}" is not a whole number of bytes`;
    }
    bytes.push(value);
  }
  const name = fields.interface_name;
  const interface_name =
    typeof name === "string" && name.trim() !== "" ? name.trim().slice(0, 100) : null;
  return { recorded_at, tx_bytes: bytes[0], rx_bytes: bytes[1], interface_name };
}

class Collector {
  rows: ImportRow[] = [];
  errors: string[] = [];
  rejected = 0;

  take(label: string, candidate: ImportRow | string) {
    if (typeof candidate === "string") {
      this.rejected += 1;
      if (this.errors.length < MAX_ERRORS) this.errors.push(`${label}: ${candidate}`);
    } else {
      this.rows.push(candidate);
    }
  }

  result(): ParseResult {
    return { rows: this.rows, errors: this.errors, rejected: this.rejected };
  }
}

/**
 * Split one CSV line. Fields are plain unless wrapped in double quotes, in
 * which case a comma is literal and a doubled quote is one quote; that is the
 * form the export writes for an interface name with a comma in it.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

export function parseReadingsCsv(text: string): ParseResult {
  const c = new Collector();
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);

  const header = lines[0] ? splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase()) : [];
  for (const column of REQUIRED) {
    if (!header.includes(column)) {
      c.errors.push(`header: missing column ${column}`);
      return c.result();
    }
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const values = splitCsvLine(line);
    const fields: Fields = {};
    header.forEach((name, index) => {
      fields[name] = values[index] ?? "";
    });
    c.take(`line ${i + 1}`, toImportRow(fields));
  }
  return c.result();
}

export function parseReadingsJson(text: string): ParseResult {
  const c = new Collector();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    c.errors.push("body: not valid JSON");
    return c.result();
  }
  if (!Array.isArray(parsed)) {
    c.errors.push("body: expected a JSON array");
    return c.result();
  }
  parsed.forEach((item, index) => {
    const label = `item ${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      c.take(label, "not an object");
    } else {
      c.take(label, toImportRow(item as Fields));
    }
  });
  return c.result();
}
