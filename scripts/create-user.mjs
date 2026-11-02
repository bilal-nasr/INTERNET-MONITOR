#!/usr/bin/env node
/**
 * Prints the SQL that creates the first account, because there is no sign-up.
 *
 *   node scripts/create-user.mjs <username>
 *
 * Asks for the password, then prints one INSERT to run against the database.
 * Nothing is sent anywhere, and the password never appears in the output or in
 * shell history. The hash format matches lib/auth/password.ts.
 */

import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const N = 16384;
const r = 8;
const p = 1;
const MIN_LENGTH = 8;

const username = process.argv[2];
if (!username) {
  console.error("Usage: node scripts/create-user.mjs <username>");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
const write = rl._writeToOutput?.bind(rl);
const prompt = "Password: ";
rl._writeToOutput = (text) => {
  if (text.startsWith(prompt)) write?.(prompt);
};
const password = await rl.question(prompt);
rl.close();
process.stderr.write("\n");

if (password.length < MIN_LENGTH) {
  console.error(`The password needs at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}

const salt = randomBytes(16);
const derived = await scrypt(password, salt, 64, { N, r, p, maxmem: 256 * N * r });
const hash = ["scrypt", N, r, p, salt.toString("base64"), derived.toString("base64")].join("$");
const name = username.replaceAll("'", "''");

console.log(`INSERT INTO users (username, email, password_hash) VALUES ('${name}', NULL, '${hash}');`);
