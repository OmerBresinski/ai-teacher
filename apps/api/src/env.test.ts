import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { parseEnv } from "./env";

const base = { DATABASE_URL: "postgres://postgres:postgres@localhost:5432/teaching_journey" };

describe("parseEnv", () => {
  test("applies defaults", () => {
    const r = parseEnv(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.env).toEqual({
      NODE_ENV: "development",
      PORT: 3001,
      DATABASE_URL: base.DATABASE_URL,
      WEB_ORIGIN: ["http://localhost:5173"],
      LOG_LEVEL: "info",
    });
  });

  test("coerces PORT and splits WEB_ORIGIN", () => {
    const r = parseEnv({
      ...base,
      PORT: "4000",
      WEB_ORIGIN: "https://app.example.com, https://preview.example.com",
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.env.PORT).toBe(4000);
    expect(r.env.WEB_ORIGIN).toEqual(["https://app.example.com", "https://preview.example.com"]);
    expect(r.env.NODE_ENV).toBe("production");
    expect(r.env.LOG_LEVEL).toBe("warn");
  });

  test("missing DATABASE_URL → `DATABASE_URL: Required`", () => {
    const r = parseEnv({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([{ variable: "DATABASE_URL", message: "Required" }]);
  });

  test("reports every invalid variable once", () => {
    const r = parseEnv({ DATABASE_URL: "not a url", PORT: "abc", LOG_LEVEL: "loud" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.variable).sort()).toEqual(["DATABASE_URL", "LOG_LEVEL", "PORT"]);
  });
});

describe("loadEnv", () => {
  test("prints `VAR: message` lines and exits 1 (no stack)", async () => {
    const script = `import { loadEnv } from "${import.meta.dir}/env.ts"; loadEnv(); console.log("unreachable");`;
    const proc = Bun.spawn(["bun", "-e", script], {
      // Bun auto-loads `.env` from the cwd; run from the OS temp dir so apps/api/.env is ignored.
      cwd: tmpdir(),
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(code).toBe(1);
    expect(stdout).not.toContain("unreachable");
    expect(stderr).toContain("DATABASE_URL: Required");
    expect(stderr).not.toMatch(/at .*\.ts:\d+/);
  });
});
