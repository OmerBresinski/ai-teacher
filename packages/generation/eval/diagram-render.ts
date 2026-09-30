// @ts-nocheck -- bench tool: imports React and Playwright from sibling installs.
/*
 * Diagram bench render (spike/diagram-bench): each saved slide-bench write record drawn as plan-write
 * would land it, on the default theme, to HTML then PNG at 1440 x 810.
 *   bun eval/diagram-render.ts <benchOut> <pngDir> <before|after>
 * before: a schema miss fails the writer (twice in prod) and lands the "missing-material" stub; a
 *   valid spec that does not draw takes the no-picture layout.
 * after: the diagram is parsed apart from the slide; a spec that fails or does not draw takes the
 *   no-picture layout (a normal teaching slide); only a miss outside the diagram is a stub.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme, materialiseSlide, withDiagramDrawn } from "@tj/slides";
import { chromium } from "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/pv-look/apps/web/node_modules/@playwright/test/index.mjs";
import { createElement } from "../../editor/node_modules/react";
import { renderToStaticMarkup } from "../../editor/node_modules/react-dom/server";
import { SlideStatic } from "../../editor/src/thumb";
import { DiagramSpecSchema } from "../src/plan-write/diagram-spec";
import { renderWritten, type Written } from "../src/plan-write/fit";
import { noPictureOf } from "../src/plan-write/slide-check";

const [benchOut, pngDir, phase] = process.argv.slice(2) as [string, string, string];
mkdirSync(pngDir, { recursive: true });
const THEME = "chalk";
const theme = getTheme(THEME);
const meta = { promptVersion: "bench", model: "gpt-6-luna", at: "2026-09-30T00:00:00.000Z" };
const make = (form: string, layout: string, out: Written) => {
  const r = renderWritten(form, layout, out);
  return materialiseSlide(r.spec, THEME, meta, undefined, r.variant, r.structure);
};
const nm =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/pv-t3/packages/editor/node_modules";
const fonts = readFileSync(join(nm, "../src/styles/fonts.css"), "utf8").replace(
  /@import "([^"]+)";/g,
  (_m, p) => `@import url("file://${nm}/${p}/index.css");`,
);
const css = fonts + readFileSync(join(nm, "../src/styles/slide.css"), "utf8");

const rows: string[] = [];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();
for (const f of readdirSync(join(benchOut, "write"))
  .filter((x) => x.endsWith(".json"))
  .sort()) {
  const rec = JSON.parse(readFileSync(join(benchOut, "write", f), "utf8"));
  const out = rec.out as Written;
  const specOk = DiagramSpecSchema.safeParse(out.diagram).success;
  const otherIssues = (rec.schemaIssues as string[]).filter((i) => !/\.diagram(\.|:)/.test(i));
  let outcome: string;
  let slide: ReturnType<typeof make>;
  const stub = phase === "before" ? !rec.schemaValid : otherIssues.length > 0;
  if (stub) {
    outcome = "stub";
    slide = make("discussion", "default", { prompt: rec.aim, footnote: [], notes: "" });
  } else {
    const base = make("diagram-slot", "default", out);
    const drawnSlide = specOk ? withDiagramDrawn(base, theme, out.diagram) : base;
    if (drawnSlide !== base) {
      outcome = "drawn";
      slide = drawnSlide;
    } else {
      outcome = specOk ? "no-picture (spec did not draw)" : "no-picture (spec failed schema)";
      slide = make("explain", "default", noPictureOf(out));
    }
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css} body{margin:0}</style></head><body>${renderToStaticMarkup(createElement(SlideStatic, { slide, theme, width: 1440 }))}</body></html>`;
  const name = f.replace(/\.json$/, "");
  writeFileSync(join(pngDir, `${name}.html`), html);
  await page.goto(`file://${join(process.cwd(), pngDir, `${name}.html`)}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(pngDir, `${name}.png`) });
  rows.push(
    `| ${name} | ${rec.schemaValid ? "ok" : "miss"} | ${specOk ? "ok" : "fail"} | ${outcome} | ${(rec.schemaIssues as string[]).map((i) => i.replace(/^slide\d+\./, "")).join("; ") || "-"} |`,
  );
}
await browser.close();
const table = [
  "| slide | writer schema | diagram spec | lands as | schema issues |",
  "|---|---|---|---|---|",
  ...rows,
].join("\n");
writeFileSync(join(pngDir, "outcomes.md"), `${table}\n`);
console.log(table);
