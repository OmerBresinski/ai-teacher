import { describe, expect, it } from "bun:test";
import { loadGsap, prefersReducedMotion } from "./gsap";

const srcDirectory = new URL("../", import.meta.url);

/** A static `import`/`export ... from "gsap"`, or a bare side-effect `import "gsap"`. Matches
 * single or double quotes; does not match `import("gsap")` (a call, not a `from` clause) or a
 * subpath like `"gsap/Flip"` (ADR 0028's plugin note — those get their own dynamic import too). */
const STATIC_GSAP_IMPORT = /\bfrom\s+["']gsap["']|^\s*import\s+["']gsap["']/m;

describe("loadGsap", () => {
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
