import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/*
 * The icon library is about 48 KB gzipped (TEACH-310 part c) and the lesson editor's chunk has
 * about 5.7 KB of headroom (#521 review), so code that reaches the browser loads it with a dynamic
 * `import("@tj/slides/icons")`. This walks every client-side source file and fails on any static
 * import of the module: named, side-effect (`import "..."`) or re-export, by package name or by a
 * relative path into `packages/slides/src/icons`, except the light modules (`LIGHT`: the loader and
 * the matcher, which hold no drawings and import none). Server-only packages (generation, worker, api,
 * images, extract) may import it statically; nothing they hold reaches a browser chunk.
 */
const ROOT = resolve(import.meta.dir, "../../../..");
const ICONS = resolve(import.meta.dir);
const CLIENT = ["apps/web/src", "packages/editor/src", "packages/slides/src", "packages/ui/src"];
const CLIENT_PACKAGES = ["packages/domain/src", "packages/api-client/src"];
/** Icon modules a client may import statically: no drawings, and no static import of one. */
const LIGHT = ["loader", "match", "catalogue", "concepts", "concepts-layouts", "types"].map((m) =>
  join(ICONS, m),
);
const isLight = (target: string) => LIGHT.includes(target.replace(/\.ts$/, ""));

/** Every static module specifier in a source: `import ... from`, `import "..."`, `export ... from`. */
export function staticSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const out: string[] = [];
  const re =
    /(?:^|[;\n}])\s*(?:import\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+)["']([^"']+)["']/g;
  for (const m of code.matchAll(re)) out.push(m[1] as string);
  return out;
}

/** Whether a specifier written in `file` names the icon module. */
export function reachesIcons(file: string, spec: string): boolean {
  if (/^@tj\/slides\/icons(?:\/|$)/.test(spec)) return true;
  if (!spec.startsWith(".")) return false;
  const target = resolve(dirname(file), spec);
  return (target === ICONS || target.startsWith(ICONS + sep)) && !isLight(target);
}

function sources(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(path).isDirectory()) out = out.concat(sources(path));
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.(test|spec)\.[tj]sx?$/.test(name))
      out.push(path);
  }
  return out;
}

describe("the icon library is loaded lazily", () => {
  test("no client source imports the icon module statically", () => {
    const offenders: string[] = [];
    for (const dir of [...CLIENT, ...CLIENT_PACKAGES]) {
      for (const file of sources(join(ROOT, dir))) {
        if (file.startsWith(ICONS + sep)) continue; // the module's own files
        for (const spec of staticSpecifiers(readFileSync(file, "utf8"))) {
          if (reachesIcons(file, spec)) offenders.push(`${file.slice(ROOT.length + 1)}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the light modules import no drawing module statically", () => {
    for (const m of LIGHT) {
      const file = `${m}.ts`;
      const heavy = staticSpecifiers(readFileSync(file, "utf8")).filter(
        (s) => s.startsWith(".") && !isLight(resolve(dirname(file), s)),
      );
      expect(heavy, file).toEqual([]);
    }
  });

  test("named, type, side-effect and re-export imports are all seen; dynamic ones are not", () => {
    const src = [
      'import { iconSvg } from "@tj/slides/icons";',
      'import type { IconAge } from "../icons/types";',
      'import "./icons";',
      'export * from "./icons/index";',
      "export { medalRim } from './icons/medal';",
      'const lazy = () => import("@tj/slides/icons");',
      '// import "@tj/slides/icons";',
    ].join("\n");
    expect(staticSpecifiers(src)).toEqual([
      "@tj/slides/icons",
      "../icons/types",
      "./icons",
      "./icons/index",
      "./icons/medal",
    ]);
    const inSlides = join(ROOT, "packages/slides/src/templates/x.ts");
    expect(reachesIcons(inSlides, "../icons/medal")).toBe(true);
    expect(reachesIcons(join(ROOT, "packages/slides/src/x.ts"), "./icons")).toBe(true);
    expect(reachesIcons(join(ROOT, "packages/slides/src/x.ts"), "./iconsets")).toBe(false);
    expect(reachesIcons(inSlides, "../icons/loader")).toBe(false);
    expect(reachesIcons(inSlides, "../icons/match")).toBe(false);
    expect(reachesIcons(join(ROOT, "packages/editor/src/x.ts"), "lucide-react")).toBe(false);
  });
});
