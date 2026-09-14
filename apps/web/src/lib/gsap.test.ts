import { describe, expect, it } from "bun:test";
import { gsapImport, loadGsap, prefersReducedMotion } from "./gsap";

const srcDirectory = new URL("../", import.meta.url);

/** A static `import`/`export ... from "gsap"` (or a plugin subpath like `"gsap/Flip"`, per ADR
 * 0028's load rule), or a bare side-effect `import "gsap"` / `import "gsap/Flip"`. Matches single
 * or double quotes; does not match `import("gsap")` (a call, not a `from` clause). */
const STATIC_GSAP_IMPORT =
  /\bfrom\s+["']gsap(?:\/[^"']+)?["']|^\s*import\s+["']gsap(?:\/[^"']+)?["']/m;

describe("loadGsap", () => {
  // Runs first, while the module's cache is still empty, so it can exercise the empty-cache ->
  // reject -> retry path; every later test in this file relies on the real import succeeding.
  it("clears the cache on a failed import, so the next call retries and then memoises", async () => {
    const real = gsapImport.gsap;
    gsapImport.gsap = () => Promise.reject(new Error("chunk load failed"));
    try {
      await expect(loadGsap()).rejects.toThrow("chunk load failed");
    } finally {
      gsapImport.gsap = real;
    }

    const [first, second] = await Promise.all([loadGsap(), loadGsap()]);
    expect(first).toBe(second);
  });

  it("resolves the same gsap instance on repeat calls", async () => {
    const [first, second] = await Promise.all([loadGsap(), loadGsap()]);
    expect(first).toBe(second);
    expect(await loadGsap()).toBe(first);
  });

  it("configures nullTargetWarn off", async () => {
    const gsap = await loadGsap();
    // gsap.config() with no args returns the current config object.
    expect(gsap.config()).toMatchObject({ nullTargetWarn: false });
  });
});

describe("prefersReducedMotion", () => {
  it("reads matchMedia without throwing in the test DOM", () => {
    expect(typeof prefersReducedMotion()).toBe("boolean");
  });
});

describe("no static import of gsap outside lib/gsap.ts (ADR 0028)", () => {
  it("gsap reaches apps/web only through loadGsap()'s dynamic import", async () => {
    const files = new Bun.Glob("**/*.{ts,tsx}");
    const offenders: string[] = [];

    for await (const file of files.scan({ cwd: srcDirectory.pathname })) {
      if (file === "lib/gsap.ts" || file === "lib/gsap.test.ts") continue;
      const text = await Bun.file(new URL(file, srcDirectory)).text();
      if (STATIC_GSAP_IMPORT.test(text)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
