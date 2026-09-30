/**
 * The visual test page: every sample diagram on every theme, one HTML page per theme, each diagram
 * drawn at the size of a teaching slide's diagram slot (and the wide ones at the figure-wide size)
 * on the theme's ground, with the theme fonts loaded from the editor's `@fontsource` files.
 *
 *   bun packages/slides/src/diagrams/visual.ts <out-dir>
 *
 * writes `<out-dir>/<theme>.html` and `<out-dir>/index.html`; screenshot them to PNG with any
 * Chromium (the lab uses Playwright from apps/web).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { THEMES } from "../themes";
import { renderDiagram } from "./index";
import { DIAGRAM_SAMPLES } from "./samples";

const FONTS = [
  "lexend",
  "gabarito",
  "figtree",
  "source-serif-4",
  "schibsted-grotesk",
  "literata",
  "public-sans",
  "bricolage-grotesque",
  "instrument-sans",
  "atkinson-hyperlegible-next",
  "fredoka",
  "playpen-sans",
  "baloo-2",
  "nunito",
  "outfit",
];

/** A teaching slide's diagram slot (the right half under the heading), and a figure-wide one. */
const SLOT = { w: 436, h: 356 };
const WIDE = { w: 560, h: 356 };

export function visualPage(themeId: string, fontRoot: string): string {
  const t = THEMES.find((x) => x.id === themeId);
  if (!t) return "";
  const cells = Object.entries(DIAGRAM_SAMPLES).map(([name, spec]) => {
    const wide =
      name.includes("particles") || name.includes("river") || name.includes("hydrograph");
    const size = wide ? WIDE : SLOT;
    const svg = renderDiagram(spec, t, size) ?? "<p>INVALID</p>";
    return `<figure style="width:${size.w}px"><div class="slot" style="width:${size.w}px;height:${size.h}px">${svg}</div><figcaption>${name}</figcaption></figure>`;
  });
  const imports = FONTS.map(
    (f) => `@import url("${fontRoot}/@fontsource-variable/${f}/index.css");`,
  ).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${t.name} diagrams</title><style>
${imports}
body{margin:0;padding:24px;background:${t.colors.background};font-family:system-ui;color:${t.colors.muted}}
h1{font:600 18px system-ui;margin:0 0 16px;color:${t.colors.ink}}
main{display:flex;flex-wrap:wrap;gap:28px;width:1480px}
figure{margin:0}.slot{outline:1px dashed ${t.colors.line}}
figcaption{font:12px system-ui;margin-top:6px}
</style></head><body><h1>${t.name} (${t.id})</h1><main>${cells.join("")}</main></body></html>`;
}

if (import.meta.main) {
  const out = resolve(process.argv[2] ?? "diagrams-visual");
  const fontRoot = `file://${resolve(import.meta.dir, "../../../editor/node_modules")}`;
  mkdirSync(out, { recursive: true });
  for (const t of THEMES) writeFileSync(join(out, `${t.id}.html`), visualPage(t.id, fontRoot));
  writeFileSync(
    join(out, "index.html"),
    `<!doctype html><ul>${THEMES.map((t) => `<li><a href="${t.id}.html">${t.name}</a></li>`).join("")}</ul>`,
  );
  console.log(`${THEMES.length} theme pages in ${out}`);
}
