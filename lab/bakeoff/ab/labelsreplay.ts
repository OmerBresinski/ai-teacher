// D31 fix ($0): every diagram the polish and polish2 runs drew, laid out again under polish2's
// per-label gate before (no protected labels) and after (objective words, key terms and slide words
// protected). Lists each label dropped, refitted or sent to base4, and draws the family trees.
// bun lab/bakeoff/ab/labelsreplay.ts <outDir>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "../../../apps/web/node_modules/@playwright/test/index.mjs";
import {
  type LabelEvent,
  onLabelDrop,
  setDiagramPolish,
  withProtectedText,
} from "../../../packages/slides/src/diagrams/polish";
import { atFullSize, layoutTemplate } from "../../../packages/slides/src/templates/index";
import { getTheme, withKeyStage } from "../../../packages/slides/src/themes";
import { AB } from "./arms";
import { protectSources } from "./polish";

const RUNS = `${AB}/runs`;
const out = process.argv[2] as string;
mkdirSync(out, { recursive: true });
const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));

type Row = {
  run: string;
  lesson: string;
  slide: number;
  kind: string;
  before: LabelEvent[];
  after: LabelEvent[];
  lost: boolean;
};
const rows: Row[] = [];
const cells: string[] = [];
const dirs = [...new Bun.Glob("polish{,2}-*/T/*/diagrams.jsonl").scanSync(RUNS)].sort();
for (const f of dirs) {
  const [run, , lesson] = f.split("/") as [string, string, string];
  const dir = `${RUNS}/${run}/T/${lesson}`;
  const brief = read(`${dir}/brief.json`);
  const theme = getTheme(brief.theme, brief.keyStage);
  const main = JSON.parse(read(`${dir}/main.json`).text);
  // Objectives: the run's objectives.json, else the lesson's record of them.
  const objectives = existsSync(`${dir}/objectives.json`)
    ? read(`${dir}/objectives.json`).objectives
    : read(`${dir}/lesson.json`).bakeoff?.objectives;
  const plan = { objectives, slides: main.slides };
  const last = new Map<string, unknown>();
  for (const l of readFileSync(`${RUNS}/${f}`, "utf8").split("\n").filter(Boolean)) {
    const d = JSON.parse(l);
    if (/^\d+:(diagram|figure)$/.test(d.key) && d.spec?.kind) last.set(d.key, d.spec);
  }
  for (const [key, spec] of last) {
    const slide = Number(key.split(":")[0]) + 1;
    const ws = main.slides[slide - 3] ?? {};
    const input = {
      template: ws.template === "big-visual" ? "big-diagram" : "diagram-text",
      heading: String(ws.heading ?? "Heading"),
      ...(ws.lead ? { lead: String(ws.lead) } : {}),
      ...(Array.isArray(ws.points)
        ? { points: ws.points.map((p: unknown) => (typeof p === "string" ? p : JSON.stringify(p))) }
        : {}),
      figure: { diagram: spec },
    };
    const lay = (protect: string[]) => {
      const ev: LabelEvent[] = [];
      onLabelDrop((e) => ev.push(e));
      setDiagramPolish(true, "label");
      try {
        const r = withProtectedText(protect, () =>
          withKeyStage(brief.keyStage, () =>
            atFullSize(() => layoutTemplate(input as never, theme, brief.keyStage)),
          ),
        ) as { slide: { elements: { type: string; src?: string }[] }; diagram?: string[] };
        return { r, ev };
      } finally {
        setDiagramPolish(false);
        onLabelDrop(() => {});
      }
    };
    const a = lay([]);
    const b = lay(protectSources(ws, plan));
    if (!a.ev.length && !b.ev.length) continue;
    rows.push({
      run,
      lesson,
      slide,
      kind: String((spec as { kind: string }).kind),
      before: a.ev,
      after: b.ev,
      lost: Boolean(b.r.diagram?.length),
    });
    const img = (r: typeof a.r) =>
      r.slide.elements.find((e) => e.type === "image" && e.src?.startsWith("data:image/svg"))?.src;
    const bg = theme.colors.panel ?? theme.colors.surface;
    const fig = (r: typeof a.r, cap: string) =>
      `<figure style="margin:0 8px"><figcaption>${cap}</figcaption>${img(r) ? `<img src="${img(r)}" style="width:520px;background:${bg}">` : "<p>(no diagram)</p>"}</figure>`;
    const say = (ev: LabelEvent[]) =>
      ev
        .map((e) => `${e.outcome ?? "drop"}: ${e.label}`)
        .filter((x, i, xs) => xs.indexOf(x) === i)
        .join("; ");
    cells.push(
      `<section data-lesson="${lesson}" style="margin:12px;padding:8px;background:#fff;font:13px sans-serif"><div>${run} ${lesson} s${slide} (${(spec as { kind: string }).kind})</div><div style="display:flex">${fig(a.r, `before: ${say(a.ev)}`)}${fig(b.r, `after: ${say(b.ev) || "nothing dropped"}`)}</div></section>`,
    );
  }
}
writeFileSync(
  `${out}/labels.html`,
  `<html><body style="background:#eee">${cells.join("")}</body></html>`,
);
writeFileSync(`${out}/labels.json`, `${JSON.stringify(rows, null, 1)}\n`);
for (const r of rows) {
  const s = (ev: LabelEvent[]) =>
    [...new Set(ev.map((e) => `${e.outcome ?? "drop"}:${e.label}`))].join(", ");
  console.log(
    `${r.run} ${r.lesson} s${r.slide} ${r.kind} | before ${s(r.before)} | after ${s(r.after)}${r.lost ? " | LOST" : ""}`,
  );
}
// A screenshot per family tree (own headless browser on the file; no dev server).
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1140, height: 800 } });
  await page.goto(`file://${out}/labels.html`);
  const secs = await page.$$('section[data-lesson="y8-french-my-family"]');
  for (const [i, s] of secs.entries()) await s.screenshot({ path: `${out}/y8-tree-${i + 1}.png` });
  console.log(`y8 trees: ${secs.length}`);
} finally {
  await browser.close();
}
