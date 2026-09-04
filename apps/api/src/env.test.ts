import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { parseEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/teaching_journey",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
};

describe("parseEnv", () => {
  test("applies defaults", () => {
    const r = parseEnv(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.env).toMatchObject({
      NODE_ENV: "development",
      PORT: 3001,
      DATABASE_URL: base.DATABASE_URL,
      WEB_ORIGIN: ["http://localhost:5173"],
      LOG_LEVEL: "info",
      BETTER_AUTH_SECRET: base.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: "http://localhost:3001",
      COOKIE_SAMESITE: "lax",
      MAIL_PROVIDER: "console",
    });
  });

  test("auth: short BETTER_AUTH_SECRET and blank optionals", () => {
    const short = parseEnv({ ...base, BETTER_AUTH_SECRET: "short" });
    expect(short.ok).toBe(false);
    if (short.ok) return;
    expect(short.errors[0]?.variable).toBe("BETTER_AUTH_SECRET");
    expect(short.errors[0]?.message).toContain("openssl rand -base64 32");

    const missing = parseEnv({ DATABASE_URL: base.DATABASE_URL });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors).toEqual([{ variable: "BETTER_AUTH_SECRET", message: "Required" }]);

    const blank = parseEnv({ ...base, GOOGLE_CLIENT_ID: "", COOKIE_DOMAIN: " " });
    expect(blank.ok).toBe(true);
    if (!blank.ok) return;
    expect(blank.env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(blank.env.COOKIE_DOMAIN).toBeUndefined();
  });

  test('ENABLE_TEST_ROUTES must be "1" and never in production', () => {
    expect(parseEnv({ ...base, ENABLE_TEST_ROUTES: "1" }).ok).toBe(true);
    const bad = parseEnv({ ...base, ENABLE_TEST_ROUTES: "yes" });
    expect(bad.ok).toBe(false);
    const prod = parseEnv({ ...base, ENABLE_TEST_ROUTES: "1", NODE_ENV: "production" });
    expect(prod.ok).toBe(false);
    if (prod.ok) return;
    expect(prod.errors).toEqual([
      { variable: "ENABLE_TEST_ROUTES", message: "Cannot be set when NODE_ENV=production" },
    ]);
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

  test("WEB_ORIGIN_PATTERNS: empty by default, split and validated as origin globs", () => {
    const none = parseEnv(base);
    expect(none.ok && none.env.WEB_ORIGIN_PATTERNS).toEqual([]);
    const ok = parseEnv({
      ...base,
      WEB_ORIGIN_PATTERNS: "https://*.vercel.app, https://tj-web-*-team.vercel.app",
    });
    expect(ok.ok && ok.env.WEB_ORIGIN_PATTERNS).toEqual([
      "https://*.vercel.app",
      "https://tj-web-*-team.vercel.app",
    ]);
    const bad = parseEnv({ ...base, WEB_ORIGIN_PATTERNS: "https://app.example.com" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors[0]?.variable).toBe("WEB_ORIGIN_PATTERNS");
    expect(bad.errors[0]?.message).toContain("origin glob");
  });

  test("COOKIE_SAMESITE accepts lax|none|strict, defaults to lax", () => {
    expect(parseEnv({ ...base, COOKIE_SAMESITE: "none" }).ok).toBe(true);
    expect(parseEnv({ ...base, COOKIE_SAMESITE: "none", NODE_ENV: "production" }).ok).toBe(true);
    expect(parseEnv({ ...base, COOKIE_SAMESITE: "None" }).ok).toBe(false);
  });

  test("missing DATABASE_URL → `DATABASE_URL: Required`", () => {
    const r = parseEnv({ BETTER_AUTH_SECRET: base.BETTER_AUTH_SECRET });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([{ variable: "DATABASE_URL", message: "Required" }]);
  });

  test("reports every invalid variable once", () => {
    const r = parseEnv({
      ...base,
      DATABASE_URL: "not a url",
      PORT: "abc",
      LOG_LEVEL: "loud",
    });
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
