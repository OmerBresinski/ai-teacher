// Arm C: wraps an agent's HTML fragment as a standalone 1920x1080 page in the lesson's tokens.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Tokens } from "./tokens.ts";

/** Strips scripts and inline handlers; inlines tool-drawn SVG diagrams (so they use the theme fonts). */
export function prepare(fragment: string, runDir: string): string {
  let h = fragment
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "");
  h = h.replace(
    /<img\b([^>]*?)\bsrc\s*=\s*["']assets\/(d[\w-]+\.svg)["']([^>]*)>/gi,
    (m, a, file, b) => {
      const f = join(runDir, "assets", file);
      if (!existsSync(f)) return m;
      const attrs = `${a} ${b}`.replace(/\/\s*$/, "").replace(/\salt\s*=\s*("[^"]*"|'[^']*')/i, "");
      const svg = readFileSync(f, "utf8").replace(
        /<svg\b([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/,
        '<svg$1 width="100%" height="100%"',
      );
      return `<div data-diagram="${file}" ${attrs.trim()}>${svg}</div>`;
    },
  );
  return h;
}

export function wrap(fragment: string, tk: Tokens, runDir: string): string {
  const vars = Object.entries(tk.vars)
    .map(([k, v]) => `${k}:${v};`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8">${tk.fontsLink}<style>
:root{${tk.fontFaces}}
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:1920px;height:1080px;overflow:hidden;background:#fff}
#slide{${vars}position:relative;width:1920px;height:1080px;overflow:hidden;background:var(--bg);color:var(--ink);font-family:var(--font-body);font-weight:var(--fw-body);font-size:var(--fs-body);line-height:var(--lh-body)}
#slide [data-diagram] svg{display:block}
</style></head><body><div id="slide">${prepare(fragment, runDir)}</div></body></html>`;
}
