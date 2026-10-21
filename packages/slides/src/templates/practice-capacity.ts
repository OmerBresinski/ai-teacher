/**
 * Practice and exit ticket capacity (TEACH-230 part b, ruling 215): the published limits a task,
 * measured by the renderer, never copied from the gold. As the gold's `probe.mjs` does, every item
 * carries the same real prose; for each age, variant and count, `cap` is the longest task (in
 * characters, cut at a word) that lays out at the body step on every theme, `hardMax` the longest
 * that still fits at the step under it. Regenerate:
 * `bun packages/slides/src/templates/practice-capacity.ts`.
 */
import { writeFileSync } from "node:fs";
import type { Theme } from "@tj/domain/documents";
import { THEMES } from "../themes";
import { layoutTemplate, type TemplateInput } from "./index";
import { AGES, type Age, type WorkCap, type WorkVariant, withoutCaps } from "./practice";

const PROSE =
  "Explain how the heart pumps blood through the arteries to every part of the body and why the left side has a thicker wall than the right side when the body is working hard during a race";

/** About `n` characters of the prose, cut at a word. */
export function workSample(n: number): string {
  let out = "";
  for (const w of [...PROSE.split(" "), ...PROSE.split(" ")]) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > n) break;
    out = next;
  }
  return out || "Word";
}
const wordsIn = (s: string) => s.split(/\s+/).filter(Boolean).length;

const PHOTO = { photo: "https://x.test/p.jpg", aspect: 4 / 3, alt: "A picture" };
const FIGURE = {
  diagram: {
    kind: "bar-chart",
    alt: "Rainfall (mm)",
    title: "Rainfall (mm)",
    bars: ["M", "A", "M", "J", "J", "A"].map((label, i) => ({ label, value: 50 + 7 * i })),
  },
};

export const VARIANT_COUNTS: Record<WorkVariant, number[]> = {
  practice: [2, 3, 4, 5, 6],
  "practice+picture": [2, 3, 4],
  "practice+figure": [2, 3, 4],
  exit: [1, 2, 3],
};

export function workInput(variant: WorkVariant, n: number, chars: number): TemplateInput {
  const questions = Array.from({ length: n }, () => workSample(chars));
  if (variant === "exit") return { template: "exit-ticket", heading: "The heart", questions };
  return {
    template: "practice",
    heading: "The heart",
    questions,
    ...(variant === "practice+picture" ? { figure: PHOTO } : {}),
    ...(variant === "practice+figure" ? { figure: FIGURE } : {}),
  };
}

/** Lays the cell out on every theme: comfortable (body step) and fits (at all). */
export function workFits(
  variant: WorkVariant,
  age: Age,
  n: number,
  chars: number,
  themes: readonly Theme[] = THEMES,
) {
  return withoutCaps(() => {
    let comfortable = true;
    let fits = true;
    for (const t of themes) {
      const r = layoutTemplate(workInput(variant, n, chars), t, AGES[age]);
      const over = r.over.length > 0 || (r.diagram?.length ?? 0) > 0;
      if (over) fits = false;
      if (over || r.tight) comfortable = false;
      if (!fits) break;
    }
    return { comfortable, fits };
  });
}

function longest(ok: (chars: number) => boolean, max = 260): number {
  if (!ok(1)) return 0;
  let lo = 1;
  let hi = max;
  if (ok(hi)) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function measureWorkCap(
  variant: WorkVariant,
  age: Age,
  n: number,
  themes = THEMES,
): WorkCap {
  const cap = longest((ch) => workFits(variant, age, n, ch, themes).comfortable);
  const hard = longest((ch) => workFits(variant, age, n, ch, themes).fits);
  const len = (ch: number) => (ch ? workSample(ch).length : 0);
  return {
    n,
    cap: len(cap),
    hardMax: len(hard),
    words: cap ? wordsIn(workSample(cap)) : 0,
    hardWords: hard ? wordsIn(workSample(hard)) : 0,
  };
}

if (import.meta.main) {
  const table = Object.fromEntries(
    (Object.keys(AGES) as Age[]).map((age) => [
      age,
      Object.fromEntries(
        (Object.keys(VARIANT_COUNTS) as WorkVariant[]).map((v) => [
          v,
          VARIANT_COUNTS[v].map((n) => measureWorkCap(v, age, n)),
        ]),
      ),
    ]),
  );
  writeFileSync(
    new URL("./practice-capacity.json", import.meta.url),
    `${JSON.stringify(table, null, 2)}\n`,
  );
  console.log(JSON.stringify(table));
}
