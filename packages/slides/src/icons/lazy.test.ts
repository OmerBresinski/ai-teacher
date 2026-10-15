import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * The icon library is about 48 KB gzipped (TEACH-310 part c) and the lesson editor's chunk has
 * about 5.7 KB of headroom (#521 review), so the editor and the web app load it with a dynamic
 * `import("@tj/slides/icons")`. A static import, or the slides barrel re-exporting it, would put
 * every drawing in the editor's first chunk.
 */
const ROOT = join(import.meta.dir, "../../../..");
const SCANNED = ["packages/editor/src", "apps/web/src"];
const STATIC = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']@tj\/slides\/icons["']/;

function sources(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(sources(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("the icon library is loaded lazily", () => {
  test("no editor or web source imports @tj/slides/icons statically", () => {
    const offenders = SCANNED.flatMap((d) => sources(join(ROOT, d)))
      .filter((f) => STATIC.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  test("the slides barrel does not re-export the icons", () => {
    const barrel = readFileSync(join(ROOT, "packages/slides/src/index.ts"), "utf8");
    expect(barrel).not.toMatch(/["']\.\/icons(?:\/index)?["']/);
  });

  test("the pattern catches a static import and lets a dynamic one through", () => {
    expect(STATIC.test('import { iconSvg } from "@tj/slides/icons";')).toBe(true);
    expect(STATIC.test('export * from "@tj/slides/icons";')).toBe(true);
    expect(STATIC.test('const icons = await import("@tj/slides/icons");')).toBe(false);
  });
});
