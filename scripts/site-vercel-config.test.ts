/**
 * Guards `homepage/vercel.json`, the marketing project that serves dayback.app (TEACH-78): a
 * static root build with no SPA fallback (unknown paths get the real 404.html), one trailing-slash
 * policy, www folded into the apex in a single permanent redirect, and a CSP that lets the hero's
 * GET form leave for the app.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const config = JSON.parse(readFileSync(resolve(root, "homepage/vercel.json"), "utf8"));

describe("homepage/vercel.json", () => {
  test("builds the root site through the env resolver and checks it with the same flags", () => {
    expect(config.installCommand).toBe("");
    expect(config.outputDirectory).toBe("dist");
    expect(config.buildCommand).toBe(
      "cd .. && bun scripts/vercel-env.ts site exec bun homepage/build.mjs && " +
        "bun scripts/vercel-env.ts site exec bun homepage/check.mjs",
    );
    expect(config.ignoreCommand).toBe("bash vercel-ignore-build.sh");
    const ignore = readFileSync(resolve(root, "homepage/vercel-ignore-build.sh"), "utf8");
    expect(ignore).toContain("PATHS=(homepage scripts/vercel-env.ts scripts/lib)");
    expect(ignore).toContain('!= "production"');
  });

  test("no SPA fallback: nothing is rewritten, so a missing page is Vercel's 404.html with 404", () => {
    expect(config.rewrites).toBeUndefined();
    expect(config.cleanUrls).toBeUndefined();
    expect(config.trailingSlash).toBe(true);
  });

  test("www redirects once to the apex, keeping the path (Vercel keeps the query)", () => {
    expect(config.redirects).toEqual([
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.dayback.app" }],
        destination: "https://dayback.app/:path*",
        permanent: true,
      },
    ]);
  });

  test("security headers everywhere; the CSP allows the hero's GET to teach and nothing wider", () => {
    const [all] = config.headers;
    expect(all.source).toBe("/(.*)");
    const h = Object.fromEntries(
      all.headers.map((x: { key: string; value: string }) => [x.key, x.value]),
    );
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Robots-Tag"]).toBeUndefined();
    const csp: string = h["Content-Security-Policy-Report-Only"];
    const formAction = csp.split(";").find((d) => d.trim().startsWith("form-action"));
    expect(formAction?.trim()).toBe("form-action 'self' https://teach.dayback.app");
    // Static header, so it must name the same app origin the build hands the hero form to: the
    // homepage/config.mjs default, which production also sets as SITE_APP_URL (PROVIDER-STEPS).
    const configSource = readFileSync(resolve(root, "homepage/config.mjs"), "utf8");
    const appDefault = configSource.match(/flag\("app"\) \?\? "([^"]+)"/)?.[1];
    expect(appDefault).toBe("https://teach.dayback.app");
    expect(formAction?.trim()).toBe(`form-action 'self' ${appDefault}`);
    expect(csp).not.toContain("*");
    expect(csp).not.toContain("'unsafe-inline'");
  });
});
