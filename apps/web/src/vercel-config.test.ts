/**
 * Guards `vercel.json` (TEACH-25): the SPA rewrite must not swallow hashed assets, cache headers
 * must split immutable assets from the always-revalidated HTML shell, and the report-only CSP must
 * allow exactly the inline theme-init script that `vite.config.ts` injects into `index.html`
 * (by hash, not `'unsafe-inline'`). If `THEME_INIT_SCRIPT` changes, this test tells you the new
 * hash to paste into `vercel.json`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { THEME_INIT_SCRIPT } from "@tj/ui";

interface Header {
  key: string;
  value: string;
}
interface VercelConfig {
  framework: string;
  buildCommand: string;
  installCommand: string;
  outputDirectory: string;
  ignoreCommand: string;
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: Header[] }[];
}

const config: VercelConfig = JSON.parse(
  readFileSync(resolve(__dirname, "..", "vercel.json"), "utf8"),
);

/** Vercel `source` patterns are path-to-regexp; the ones we use are plain regex groups. */
function matches(source: string, path: string): boolean {
  const pattern = source
    .replace(/^\/\((.*)\)$/, "^/($1)$")
    .replace(/^\/assets\/\(\.\*\)$/, "^/assets/(.*)$");
  return new RegExp(pattern).test(path);
}

function headersFor(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of config.headers) {
    if (!matches(rule.source, path)) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

describe("vercel.json", () => {
  test("static Vite build from the monorepo root", () => {
    expect(config.framework).toBe("vite");
    expect(config.outputDirectory).toBe("dist");
    expect(config.installCommand).toBe(
      "cd ../.. && bun install --frozen-lockfile --ignore-scripts",
    );
    expect(config.buildCommand).toContain("bun scripts/vercel-env.ts exec");
    expect(config.buildCommand).toContain("turbo run build --filter=@tj/web");
    expect(config.ignoreCommand).toBe("bash scripts/vercel-ignore-build.sh");
  });

  test("SPA rewrite sends deep links to index.html but leaves /assets alone", () => {
    const [rewrite] = config.rewrites;
    expect(rewrite?.destination).toBe("/index.html");
    const src = rewrite?.source ?? "";
    expect(matches(src, "/dev/jobs")).toBe(true);
    expect(matches(src, "/sign-in")).toBe(true);
    expect(matches(src, "/assets/index-abc.js")).toBe(false);
    expect(matches(src, "/_vercel/speed-insights/script.js")).toBe(false);
  });

  test("immutable assets, no-cache shell, security headers everywhere", () => {
    const asset = headersFor("/assets/index-abc.js");
    expect(asset["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    for (const path of ["/", "/index.html", "/dev/jobs"]) {
      const h = headersFor(path);
      expect(h["Cache-Control"]).toBe("no-cache");
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
      expect(h["X-Frame-Options"]).toBe("DENY");
      expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["Permissions-Policy"]).toContain("camera=()");
      expect(h["Content-Security-Policy-Report-Only"]).toContain("connect-src 'self' https:");
    }
    expect(asset["X-Content-Type-Options"]).toBe("nosniff");
  });

  test("CSP script-src allows the inline theme-init script by hash", async () => {
    const csp = headersFor("/")["Content-Security-Policy-Report-Only"] ?? "";
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    const hash = `'sha256-${await sha256Base64(THEME_INIT_SCRIPT)}'`;
    expect(scriptSrc, `update vercel.json script-src to ${hash}`).toContain(hash);
  });

  test("CSP style-src has no 'unsafe-inline' (the built index.html carries no inline styles)", () => {
    const csp = headersFor("/")["Content-Security-Policy-Report-Only"] ?? "";
    const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src")) ?? "";
    expect(styleSrc.trim()).toBe("style-src 'self'");
  });
});
