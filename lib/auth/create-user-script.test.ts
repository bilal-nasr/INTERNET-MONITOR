import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { verifyPassword } from "./password";

function run(username: string, password: string) {
  return spawnSync(process.execPath, ["scripts/create-user.mjs", username], {
    input: `${password}\n`,
    encoding: "utf8",
  });
}

describe("scripts/create-user.mjs", () => {
  it("prints an INSERT whose hash verifies, without the password", async () => {
    const result = run("someone", "correct horse");
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("correct horse");
    const hash = result.stdout.match(/'(scrypt\$[^']+)'/)?.[1];
    expect(hash).toBeDefined();
    expect(await verifyPassword("correct horse", hash as string)).toBe(true);
    expect(await verifyPassword("wrong horse", hash as string)).toBe(false);
  });

  it("escapes a quote in the username", () => {
    expect(run("o'neil", "correct horse").stdout).toContain("'o''neil'");
  });

  it("refuses a short password", () => {
    const result = run("someone", "short");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
  });
});
