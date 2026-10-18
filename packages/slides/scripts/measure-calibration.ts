/*
 * Calibration of the headless measurer against Chromium (text-limits M0, ADR 0040 §2).
 *
 * Lays the same text out twice: with `breakRuns` (`../src/text-lines.ts`, the wrap rule behind
 * `countLines` and `measureHeadless`) and in Chromium with the fonts the editor loads
 * (`packages/editor/src/styles/fonts.css` and `fonts-playful.css`). It compares line counts and
 * one-line widths over every theme face and weight × sizes × letter spacings × column widths, on
 * the fixed real-lesson sample in `measure-calibration.sample.json`.
 *
 * Rows fall into the clean set or into one of today's KNOWN_GAPS. The clean set must meet
 * `CURRENT`, and each gap must stay within its own ceiling. A gap that starts meeting `CURRENT`
 * fails the run until it is removed from the list, so the list only shrinks as M1/M2 land.
 * `TARGET` is the bound ADR 0040 states for after M2; it is printed, and enforced with `--target`.
 *
 * Usage (needs Playwright's Chromium, as apps/web's e2e suite does):
 *   bun packages/slides/scripts/measure-calibration.ts          # CI sample, about 15 s
 *   bun packages/slides/scripts/measure-calibration.ts --full   # full sweep, about 90 s
 *   ... --json <file>                                           # every row, for analysis
 *
 * Playwright is resolved from apps/web, which pins it; @tj/slides itself does not depend on it.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { FONT_STACKS, type FontKey } from "../src/fonts";
import { breakRuns } from "../src/text-lines";
import { THEMES } from "../src/themes";

const REPO = join(import.meta.dir, "../../..");
const EDITOR = join(REPO, "packages/editor");
const FULL = process.argv.includes("--full");
const TARGET_MODE = process.argv.includes("--target");
const JSON_OUT = process.argv.includes("--json")
  ? process.argv[process.argv.indexOf("--json") + 1]
  : undefined;

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

type Bound = {
  /** Share of layouts whose line count equals Chromium's. */
  exact: number;
  /** Share of layouts where the measurer counts fewer lines than Chromium (the unsafe side). */
  under: number;
  /** One-line width / Chromium − 1, 1st and 99th percentile. */
  widthLow: number;
  widthHigh: number;
};

/**
 * What the clean set measures today (18 Oct 2026, Chromium 151): 98.5% exact, 0.02% under, widths
 * +0.6% median and +1.9% at p99, the excess being kerning (KNOWN_GAPS "kerning").
 */
export const CURRENT: Bound = { exact: 0.98, under: 0.002, widthLow: -0.0075, widthHigh: 0.025 };
/** ADR 0040's bound for after M2 (coverage, exact weights, kerning, px spacing). */
export const TARGET: Bound = { exact: 0.995, under: 0.0005, widthLow: -0.005, widthHigh: 0.005 };

type Row = {
  font: FontKey;
  weight: number;
  px: number;
  ls: string;
  width: number;
  lang: string;
  text: string;
  mLines: number;
  cLines: number;
  mOne: number;
  cOne: number;
};

/**
 * Today's gaps. `ceiling` is the floor of `exact` and the roof of `under` the gap may not get worse
 * than (measured 18 Oct with a margin for runner differences); `match` selects its rows.
 */
export const KNOWN_GAPS: {
  id: string;
  reason: string;
  match: (r: Row) => boolean;
  ceiling: { exact: number; under: number };
}[] = [
  {
    id: "weight-800",
    reason:
      "800 is read from the 700 table (text-measure.ts advancesFor): Lexend 800 draws ~2% wider than measured, so lines are under-counted (Paper, Poster headings). M1 adds the weight.",
    match: (r) => r.weight >= 750,
    ceiling: { exact: 0.92, under: 0.07 },
  },
  {
    id: "weight-500",
    reason:
      "500 is read from the 600 table unless exact500 (quote runs only): ~2% wide, over-counts (picture-text's lead). M1.",
    match: (r) => r.weight === 500,
    ceiling: { exact: 0.9, under: 0.01 },
  },
  {
    id: "px-spacing",
    reason:
      "letter spacing in px is ignored (text-measure.ts tablesFor, lineWidth parse em only). M1.",
    match: (r) => r.ls.endsWith("px") && Number.parseFloat(r.ls) !== 0,
    ceiling: { exact: 0.65, under: 0.35 },
  },
  {
    id: "non-ascii",
    reason:
      "every code point outside U+0020-007E counts as 1 em (FALLBACK_EM), so ’ — … é × ÷ − and maths italics over-count. M1 extends the table.",
    match: (r) => /[^\x20-\x7e]/.test(r.text),
    ceiling: { exact: 0.85, under: 0.01 },
  },
];

/** Kerning is ignored everywhere: it is why CURRENT allows widths up to +2.5% (TARGET ±0.5%). */
const KERNING_NOTE =
  "kerning is ignored (+0.6% median width); CURRENT.widthHigh allows it until M1.";

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

const keyOf = (stack: string) =>
  (Object.entries(FONT_STACKS).find(([, s]) => s === stack)?.[0] ?? "") as FontKey;

function faces(): { key: FontKey; stack: string; weight: number }[] {
  const out = new Map<string, { key: FontKey; stack: string; weight: number }>();
  const add = (stack: string, weight: number) =>
    out.set(`${keyOf(stack)}@${weight}`, { key: keyOf(stack), stack, weight });
  for (const t of THEMES) {
    add(t.fonts.title, t.weights.title);
    add(t.fonts.title, t.weights.heading);
    // Body: regular, the picture lead's 500 and a bold label's 700.
    for (const w of [t.weights.body, 500, 700]) add(t.fonts.body, w);
  }
  return [...out.values()].filter((f) => f.key);
}

const GRID = FULL
  ? { px: [24, 37, 56], ls: ["0em", "0.02em", "-0.01em", "2px"], width: [360, 632, 1100] }
  : { px: [24, 56], ls: ["0em", "0.02em", "2px"], width: [360, 1100] };

/* ------------------------------------------------------------------ */
/* Chromium                                                            */
/* ------------------------------------------------------------------ */

/** The editor's font CSS with every url made absolute, @imports inlined. */
function cssFor(file: string): string {
  const dir = dirname(file);
  const css = readFileSync(file, "utf8").replace(/@import\s+"([^"]+)";/g, (_, pkg: string) =>
    cssFor(join(EDITOR, "node_modules", pkg, "index.css")),
  );
  return css.replace(/url\(([^)]+)\)/g, (m, u: string) => {
    const p = u.replace(/["']/g, "");
    if (p.startsWith("data:")) return m;
    // Inlined, so the page needs no file origin and loads the same on any runner.
    return `url(data:font/woff2;base64,${readFileSync(resolve(dir, p)).toString("base64")})`;
  });
}

/** `--font-*` names as fonts.css defines them, so FONT_STACKS resolve. */
function fontVars(): string {
  const css = readFileSync(join(EDITOR, "src/styles/fonts.css"), "utf8");
  return css.match(/:root\s*{[^}]*}/)?.[0] ?? "";
}

type Job = { stack: string; weight: number; px: number; ls: string; width: number; text: string };
type Got = { lines: number; one: number };

/**
 * The in-page measuring code, as plain JS: @tj/slides is compiled without the DOM library (it must
 * stay DOM-free), so the browser side is a string `page.evaluate` runs.
 */
const IN_PAGE = `async (jobs) => {
  const cs = getComputedStyle(document.documentElement);
  const concrete = (s) => s.replace(/var\\((--font-[a-z-]+)\\)/g, (_, v) => cs.getPropertyValue(v).trim());
  // A face missing from a stack's subset rejects; the text then uses the fallback, as in the editor.
  for (const f of new Set(jobs.map((j) => j.weight + " 40px " + concrete(j.stack))))
    await document.fonts.load(f, "Aé−×’").catch(() => {});
  const box = document.createElement("div");
  box.className = "c";
  const one = document.createElement("span");
  one.className = "one";
  document.body.append(box, one);
  const range = document.createRange();
  const out = [];
  for (const j of jobs) {
    for (const n of [box, one]) {
      n.style.fontFamily = j.stack;
      n.style.fontWeight = String(j.weight);
      n.style.fontSize = j.px + "px";
      n.style.letterSpacing = j.ls;
    }
    box.style.width = j.width + "px";
    box.textContent = j.text;
    one.textContent = j.text;
    const node = box.firstChild;
    let lines = 0;
    let last = -Infinity;
    for (let i = 0; i < j.text.length; ) {
      const len = (j.text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
      range.setStart(node, i);
      range.setEnd(node, i + len);
      const rects = range.getClientRects();
      const b = rects[rects.length - 1];
      if (b && b.width > 0 && b.top > last + j.px * 0.5) {
        lines++;
        last = b.top;
      }
      i += len;
    }
    out.push({ lines, one: one.getBoundingClientRect().width });
  }
  box.remove();
  one.remove();
  return out;
}`;

/** The slice of Playwright's `Page` this script uses. */
type Page = { evaluate(expr: string): Promise<unknown>; goto(url: string): Promise<unknown> };

async function chromiumMeasure(page: Page, jobs: Job[]): Promise<Got[]> {
  return (await page.evaluate(`(${IN_PAGE})(${JSON.stringify(jobs)})`)) as Got[];
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

function stats(rows: Row[]) {
  const n = rows.length || 1;
  const w = rows
    .filter((r) => r.cOne > 0)
    .map((r) => r.mOne / r.cOne - 1)
    .sort((a, b) => a - b);
  const q = (p: number) => w[Math.min(w.length - 1, Math.floor(p * w.length))] ?? 0;
  return {
    n: rows.length,
    exact: rows.filter((r) => r.mLines === r.cLines).length / n,
    over: rows.filter((r) => r.mLines > r.cLines).length / n,
    under: rows.filter((r) => r.mLines < r.cLines).length / n,
    median: q(0.5),
    p01: q(0.01),
    p99: q(0.99),
  };
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const meets = (s: ReturnType<typeof stats>, b: Bound) =>
  s.exact >= b.exact && s.under <= b.under && s.p01 >= b.widthLow && s.p99 <= b.widthHigh;

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  const sample = JSON.parse(
    readFileSync(join(import.meta.dir, "measure-calibration.sample.json"), "utf8"),
  ) as Record<string, string[] | string>;
  const texts = Object.entries(sample).flatMap(([lang, xs]) =>
    Array.isArray(xs) ? xs.map((text) => ({ lang, text })) : [],
  );

  const { chromium } = await import(Bun.resolveSync("@playwright/test", join(REPO, "apps/web")));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const file = join(mkdtempSync(join(tmpdir(), "measure-calibration-")), "page.html");
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>${cssFor(join(EDITOR, "src/styles/fonts.css"))}${cssFor(join(EDITOR, "src/styles/fonts-playful.css"))}${fontVars()}
body{margin:0;-webkit-font-smoothing:antialiased}
.c{position:absolute;left:0;top:0;line-height:1.3;word-break:normal;overflow-wrap:break-word;hyphens:none;white-space:pre-wrap}
.one{position:absolute;left:0;top:3000px;white-space:pre}
</style></head><body></body></html>`,
  );
  await page.goto(`file://${file}`);

  const rows: Row[] = [];
  const t0 = performance.now();
  try {
    for (const f of faces()) {
      const jobs: (Job & { lang: string })[] = [];
      for (const px of GRID.px)
        for (const ls of GRID.ls)
          for (const width of GRID.width)
            for (const { lang, text } of texts)
              jobs.push({ stack: f.stack, weight: f.weight, px, ls, width, text, lang });
      const got = await chromiumMeasure(page, jobs);
      jobs.forEach((j, i) => {
        const type = {
          fontFamily: j.stack,
          fontWeight: j.weight,
          fontSize: j.px,
          letterSpacing: j.ls,
        };
        const g = got[i] as Got;
        rows.push({
          font: f.key,
          weight: f.weight,
          px: j.px,
          ls: j.ls,
          width: j.width,
          lang: j.lang,
          text: j.text,
          mLines: breakRuns([{ text: j.text }], type, j.width).starts.length,
          cLines: g.lines,
          mOne: (breakRuns([{ text: j.text }], type, 1e9).widths[0] ?? 0) * j.px,
          cOne: g.one,
        });
      });
    }
  } finally {
    await browser.close();
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows));

  const gapOf = (r: Row) => KNOWN_GAPS.filter((g) => g.match(r));
  const clean = rows.filter((r) => gapOf(r).length === 0);
  const fails: string[] = [];
  const line = (label: string, s: ReturnType<typeof stats>) =>
    console.log(
      `${label.padEnd(12)} n=${String(s.n).padStart(6)}  exact ${pct(s.exact)}  over ${pct(s.over)}  under ${pct(s.under, 2)}  width median ${pct(s.median, 2)} p01 ${pct(s.p01, 2)} p99 ${pct(s.p99, 2)}`,
    );

  const c = stats(clean);
  line("clean", c);
  if (!meets(c, CURRENT)) fails.push("clean rows are outside CURRENT");
  if (TARGET_MODE && !meets(c, TARGET)) fails.push("clean rows are outside TARGET");
  console.log(`             (${KERNING_NOTE})`);

  for (const g of KNOWN_GAPS) {
    // A gap is judged on the rows only it explains, so one gap cannot hide behind another.
    const own = rows.filter((r) => {
      const gs = gapOf(r);
      return gs.length === 1 && gs[0] === g;
    });
    const s = stats(own);
    line(g.id, s);
    console.log(`             known: ${g.reason}`);
    if (own.length === 0) continue;
    if (meets(s, CURRENT)) fails.push(`${g.id} now meets CURRENT: remove it from KNOWN_GAPS`);
    if (s.exact < g.ceiling.exact || s.under > g.ceiling.under)
      fails.push(
        `${g.id} got worse than its ceiling (exact ≥ ${pct(g.ceiling.exact)}, under ≤ ${pct(g.ceiling.under)})`,
      );
  }

  const worst = [...clean]
    .filter((r) => r.mLines !== r.cLines)
    .sort((a, b) => Math.abs(b.mOne / b.cOne - 1) - Math.abs(a.mOne / a.cOne - 1))
    .slice(0, 5);
  for (const r of worst)
    console.log(
      `  clean miss: ${r.font} ${r.weight} ${r.px}px ${r.ls} w${r.width}: measured ${r.mLines} lines, Chromium ${r.cLines} ("${r.text.slice(0, 50)}")`,
    );
  console.log(
    `\n${rows.length} layouts, ${FULL ? "full sweep" : "CI sample"}, ${Math.round((performance.now() - t0) / 1000)} s. TARGET (ADR 0040): exact ≥ ${pct(TARGET.exact)}, under ≤ ${pct(TARGET.under, 2)}, width ±${pct(TARGET.widthHigh)}.`,
  );
  for (const f of fails) console.log(`FAIL: ${f}`);
  process.exit(fails.length ? 1 : 0);
}

if (import.meta.main) await main();
