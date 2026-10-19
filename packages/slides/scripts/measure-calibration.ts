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
 * `CURRENT`, and each gap bucket must stay within MEASURED + MARGIN. A gap that starts meeting `CURRENT`
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
 * Today's bound for the clean set: what it measured on 18 Oct 2026 (worst of macOS and the
 * ubuntu-latest runner: 98.4% exact, 0.26% under, widths -1.31% p01 and +1.93% p99) plus a margin
 * of 0.5 points. Widths run wide because kerning is ignored; the CI runner draws some faces up to
 * 1.3% wider than the table at small sizes (likely its integer glyph advances; unverified).
 */
export const CURRENT: Bound = { exact: 0.979, under: 0.005, widthLow: -0.018, widthHigh: 0.0245 };
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
  /** A character falls outside every @font-face of the face: drawn in a system fallback. */
  fallback: boolean;
};

/**
 * Today's gaps, each with its reason; `match` selects its rows. Bounds per bucket: MEASURED.
 */
export const KNOWN_GAPS: {
  id: string;
  reason: string;
  match: (r: Row) => boolean;
}[] = [
  {
    id: "weight-500",
    reason:
      "500 is read from the 600 table unless exact500 (quote runs only): ~2% wide, over-counts (picture-text's lead). M1.",
    match: (r) => r.weight === 500,
  },
  {
    id: "px-spacing",
    reason:
      "letter spacing in px is ignored (text-measure.ts tablesFor, lineWidth parse em only). M1.",
    match: (r) => r.ls.endsWith("px") && Number.parseFloat(r.ls) !== 0,
  },
  {
    id: "non-ascii",
    reason:
      "every code point outside U+0020-007E counts as 1 em (FALLBACK_EM), so ’ — … é × ÷ − and maths italics over-count. M1 extends the table.",
    match: (r) => /[^\x20-\x7e]/.test(r.text),
  },
];

/**
 * What each gap bucket measured on 18 Oct 2026 (CI sample; worst of macOS and the CI runner where
 * both ran). A bucket is the rows that carry exactly that set of gaps, so two gaps at once are
 * judged together ("weight-500+non-ascii") and no gap hides behind another. A bucket fails when it
 * is worse than its measured value by more than MARGIN, and when it meets CURRENT (the gap closed).
 */
export const MEASURED: Record<string, Bound> = {
  // Single gaps: worst of macOS and the CI runner (run 39175379965). Combinations: macOS.
  // TEACH-215 part m measures 800 in its own advances, so the weight-800 gap is gone: its rows
  // are clean (exact 97.8%, under 0, width p01 +0.09% p99 +1.21%) and its combinations fall in
  // the px-spacing and non-ascii buckets, which still sit within these rows (macOS, 19 Oct).
  "non-ascii": { exact: 0.8982, under: 0.0011, widthLow: -0.0014, widthHigh: 0.1203 },
  "px-spacing": { exact: 0.766, under: 0.2342, widthLow: -0.1676, widthHigh: -0.0587 },
  "weight-500": { exact: 0.943, under: 0, widthLow: -0.003, widthHigh: 0.0377 },
  "px-spacing+non-ascii": { exact: 0.8327, under: 0.1491, widthLow: -0.1454, widthHigh: 0.0295 },
  "weight-500+non-ascii": { exact: 0.875, under: 0, widthLow: 0.01, widthHigh: 0.1338 },
  "weight-500+px-spacing": { exact: 0.8141, under: 0.1859, widthLow: -0.1538, widthHigh: -0.042 },
  "weight-500+px-spacing+non-ascii": {
    exact: 0.8557,
    under: 0.1235,
    widthLow: -0.1352,
    widthHigh: 0.0423,
  },
};
/** How far a bucket may drift from MEASURED before it fails: 2 points of exact, 1 of under, 1% of width. */
export const MARGIN = { exact: 0.02, under: 0.01, width: 0.01 };

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
function cssFor(file: string, inline = true): string {
  const dir = dirname(file);
  const css = readFileSync(file, "utf8").replace(/@import\s+"([^"]+)";/g, (_, pkg: string) =>
    cssFor(join(EDITOR, "node_modules", pkg, "index.css"), inline),
  );
  return css.replace(/url\(([^)]+)\)/g, (m, u: string) => {
    const p = u.replace(/["']/g, "");
    if (p.startsWith("data:") || !inline) return m;
    // Inlined, so the page needs no file origin and loads the same on any runner.
    return `url(data:font/woff2;base64,${readFileSync(resolve(dir, p)).toString("base64")})`;
  });
}

/** `--font-*` names as fonts.css defines them, so FONT_STACKS resolve. */
function fontVars(): string {
  const css = readFileSync(join(EDITOR, "src/styles/fonts.css"), "utf8");
  return css.match(/:root\s*{[^}]*}/)?.[0] ?? "";
}

/**
 * Which code points each family draws itself, from the @font-face rules (`unicode-range`, weight
 * range, normal style). A character outside them falls back to a system face, which differs by OS,
 * so such rows are reported but kept out of every bound.
 */
function coverage(css: string, vars: string) {
  const familyOfVar = new Map(
    [...vars.matchAll(/(--font-[a-z-]+):\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => {
    const b = m[1] ?? "";
    const w = b.match(/font-weight:\s*(\d+)(?:\s+(\d+))?/);
    const ranges = (b.match(/unicode-range:\s*([^;]+)/)?.[1] ?? "U+0-10FFFF")
      .split(",")
      .map((r) => {
        const [lo, hi] = r.trim().replace(/^U\+/i, "").split("-");
        const a = Number.parseInt((lo ?? "0").replace(/\?/g, "0"), 16);
        const z = Number.parseInt((hi ?? lo ?? "0").replace(/\?/g, "F"), 16);
        return [a, z] as const;
      });
    return {
      family: b.match(/font-family:\s*["']?([^;"']+)/)?.[1]?.trim() ?? "",
      italic: /font-style:\s*italic/.test(b),
      lo: Number(w?.[1] ?? 400),
      hi: Number(w?.[2] ?? w?.[1] ?? 400),
      ranges,
    };
  });
  return (stack: string, weight: number, text: string): boolean => {
    const family = familyOfVar.get(stack.match(/var\((--font-[a-z-]+)\)/)?.[1] ?? "");
    const own = faces.filter(
      (f) => f.family === family && !f.italic && weight >= f.lo - 100 && weight <= f.hi + 100,
    );
    for (const ch of text) {
      const c = ch.codePointAt(0) ?? 0;
      if (!own.some((f) => f.ranges.some(([a, z]) => c >= a && c <= z))) return false;
    }
    return true;
  };
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
  // Every theme face must really load: a missing face would silently measure the fallback.
  const missing = [...new Set(jobs.map((j) => j.weight + " 40px " + concrete(j.stack).split(",")[0]))]
    .filter((f) => !document.fonts.check(f, "A"));
  if (missing.length) return { missing, out: [] };
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
  return { missing: [], out };
}`;

/** The slice of Playwright's `Page` this script uses. */
type Page = { evaluate(expr: string): Promise<unknown>; goto(url: string): Promise<unknown> };

async function chromiumMeasure(page: Page, jobs: Job[]): Promise<Got[]> {
  const r = (await page.evaluate(`(${IN_PAGE})(${JSON.stringify(jobs)})`)) as {
    missing: string[];
    out: Got[];
  };
  if (r.missing.length) throw new Error(`theme faces did not load: ${r.missing.join("; ")}`);
  return r.out;
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
  const covered = coverage(
    cssFor(join(EDITOR, "src/styles/fonts.css"), false) +
      cssFor(join(EDITOR, "src/styles/fonts-playful.css"), false),
    fontVars(),
  );

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
          fallback: !covered(j.stack, j.weight, j.text),
        });
      });
    }
  } finally {
    await browser.close();
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows));

  const bucketOf = (r: Row) =>
    KNOWN_GAPS.filter((g) => g.match(r))
      .map((g) => g.id)
      .join("+");
  const drawn = rows.filter((r) => !r.fallback);
  const clean = drawn.filter((r) => bucketOf(r) === "");
  const fails: string[] = [];
  const line = (label: string, s: ReturnType<typeof stats>) =>
    console.log(
      `${label.padEnd(30)} n=${String(s.n).padStart(6)}  exact ${pct(s.exact)}  over ${pct(s.over)}  under ${pct(s.under, 2)}  width median ${pct(s.median, 2)} p01 ${pct(s.p01, 2)} p99 ${pct(s.p99, 2)}`,
    );

  const c = stats(clean);
  line("clean", c);
  if (!meets(c, CURRENT)) fails.push("clean rows are outside CURRENT");
  if (TARGET_MODE && !meets(c, TARGET)) fails.push("clean rows are outside TARGET");
  console.log(`  (${KERNING_NOTE})`);
  for (const px of GRID.px) line(`  clean at ${px}px`, stats(clean.filter((r) => r.px === px)));

  for (const g of KNOWN_GAPS) console.log(`known gap ${g.id}: ${g.reason}`);
  const buckets = [...new Set(drawn.map(bucketOf))].filter(Boolean).sort();
  const measured: Record<string, Bound> = {};
  for (const id of buckets) {
    const s = stats(drawn.filter((r) => bucketOf(r) === id));
    line(id, s);
    measured[id] = { exact: s.exact, under: s.under, widthLow: s.p01, widthHigh: s.p99 };
    const m = MEASURED[id];
    if (meets(s, CURRENT)) fails.push(`${id} now meets CURRENT: remove the gap from KNOWN_GAPS`);
    // MEASURED was taken on the CI sample's grid; the full sweep reports its buckets unbounded.
    if (FULL) continue;
    if (!m) {
      fails.push(`${id} has no MEASURED entry (run with --print-measured)`);
      continue;
    }
    if (
      s.exact < m.exact - MARGIN.exact ||
      s.under > m.under + MARGIN.under ||
      s.p01 < m.widthLow - MARGIN.width ||
      s.p99 > m.widthHigh + MARGIN.width
    )
      fails.push(`${id} is worse than MEASURED + MARGIN`);
  }
  for (const id of Object.keys(MEASURED))
    if (!FULL && !buckets.includes(id)) fails.push(`MEASURED lists ${id}, which no row falls in`);
  const fb = stats(rows.filter((r) => r.fallback));
  line("fallback (not bounded)", fb);
  if (process.argv.includes("--print-measured")) {
    const r4 = (x: number) => Math.round(x * 10000) / 10000;
    for (const [id, m] of Object.entries(measured))
      console.log(
        `  "${id}": { exact: ${r4(m.exact)}, under: ${r4(m.under)}, widthLow: ${r4(m.widthLow)}, widthHigh: ${r4(m.widthHigh)} },`,
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
