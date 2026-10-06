/**
 * BAKEOFF arm K: each recipe's measured capacity per key stage.
 *
 * Capacities are measured, not guessed: a recipe variant is filled with real-looking words cut at a
 * word boundary, every text field at `round(N x weight)` characters, and the largest N that lays out
 * at the stage's own sizes (step 0) with the shared ruler content, on both Splash and Studio, is the
 * variant's capacity. KS3-5 is the least of ks3, ks4 and ks5.
 */
import type { Theme } from "@tj/domain/documents";
import { countLines } from "../text-measure";
import { resolveTextStyle } from "../text-style";
import { getTheme, typeScale, withKeyStage } from "../themes";
import {
  type Block,
  type BlockSlide,
  blockSizes,
  layoutBlocks,
  type RecipeId,
  type Stage,
} from "./index";

export const GROUPS: Record<string, Stage[]> = {
  KS1: ["ks1"],
  KS2: ["ks2"],
  "KS3-5": ["ks3", "ks4", "ks5"],
};
export const FIT_THEMES = ["splash", "studio"] as const;

const WORDS =
  "plants need light water and air to grow their leaves take in carbon dioxide while roots draw water from the soil and the green parts make food from sunlight which gives energy for growth flowers then make seeds that spread far away so new plants can start again in spring when the weather turns warm".split(
    " ",
  );
/** Real-looking words, at most `n` characters, cut at a word boundary; `seed` varies the start. */
export function filler(n: number, seed = 0): string {
  let out = "";
  for (let k = seed; ; k++) {
    const w = WORDS[k % WORDS.length] as string;
    const next = out ? `${out} ${w}` : w;
    if (next.length > n) break;
    out = next;
  }
  const s = out || "a";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fills a variant's blocks; `n(weight, seed)` is a field's words (weight ≥ 10: fixed characters). */
type Fill = (n: (w: number, seed: number) => string) => Block[];
export type Variant = {
  id: string;
  recipe: RecipeId;
  note: string;
  fields: Record<string, number>;
  fill: Fill;
};

const pic = { src: "", alt: "picture" };
const H = (n: (w: number, s: number) => string): Block => ({ type: "heading", text: n(0, 3) });

/** The heading is measured on its own (≤ 2 lines); in variants it is a fixed 2-line worst case. */
export const VARIANTS: Variant[] = [
  // title
  {
    id: "title+picture",
    recipe: "title",
    note: "title and subtitle with a picture",
    fields: { title: 1, subtitle: 1.4 },
    fill: (n) => [
      { type: "heading", text: n(1, 0) },
      { type: "text", text: n(1.4, 5) },
      { type: "picture", picture: pic },
    ],
  },
  {
    id: "title",
    recipe: "title",
    note: "title and subtitle, no picture",
    fields: { title: 1, subtitle: 1.4 },
    fill: (n) => [
      { type: "heading", text: n(1, 0) },
      { type: "text", text: n(1.4, 5) },
    ],
  },
  // stack
  ...[3, 4, 5].map(
    (k): Variant => ({
      id: `stack:lead+${k}points`,
      recipe: "stack",
      note: `a lead sentence and ${k} bullet points`,
      fields: { lead: 1.4, point: 1 },
      fill: (n) => [
        H(n),
        { type: "text", text: n(1.4, 1) },
        { type: "points", items: Array.from({ length: k }, (_, i) => n(1, 7 * i + 2)) },
      ],
    }),
  ),
  {
    id: "stack:4numbered",
    recipe: "stack",
    note: "4 numbered points (objectives, steps)",
    fields: { point: 1 },
    fill: (n) => [
      H(n),
      { type: "points", numbered: true, items: [0, 1, 2, 3].map((i) => n(1, 9 * i)) },
    ],
  },
  ...[3, 4].map(
    (k): Variant => ({
      id: `stack:${k}questions+instruction`,
      recipe: "stack",
      note: `${k} numbered questions and a quiet instruction line under them`,
      fields: { question: 1, instruction: 0.8 },
      fill: (n) => [
        H(n),
        ...Array.from({ length: k }, (_, i): Block => ({ type: "question", text: n(1, 6 * i) })),
        { type: "text", text: n(0.8, 4) },
      ],
    }),
  ),
  {
    id: "stack:lead+callout",
    recipe: "stack",
    note: "a lead sentence and a labelled callout (key idea, keyword and definition)",
    fields: { lead: 1, calloutLabel: 0.25, callout: 1.5 },
    fill: (n) => [
      H(n),
      { type: "text", text: n(1, 2) },
      { type: "callout", label: n(0.25, 11), text: n(1.5, 4) },
    ],
  },
  {
    id: "stack:lead+points+callout",
    recipe: "stack",
    note: "a lead, 3 points and a callout",
    fields: { lead: 1, point: 1, callout: 1.2 },
    fill: (n) => [
      H(n),
      { type: "text", text: n(1, 2) },
      { type: "points", items: [0, 1, 2].map((i) => n(1, 5 * i)) },
      { type: "callout", text: n(1.2, 4) },
    ],
  },
  ...[
    [2, 4],
    [3, 3],
    [3, 4],
    [4, 3],
  ].map(
    ([cols, rows]): Variant => ({
      id: `stack:table${cols}x${rows}`,
      recipe: "stack",
      note: `a table, ${cols} columns x ${rows} rows under a header row, with a lead line`,
      fields: { lead: 60, header: 0.7, cell: 1 },
      fill: (n) => [
        H(n),
        { type: "text", text: n(60, 1) },
        {
          type: "table",
          header: Array.from({ length: cols as number }, (_, i) => n(0.7, i * 3)),
          rows: Array.from({ length: rows as number }, (_, r) =>
            Array.from({ length: cols as number }, (_, i) => n(1, r * 5 + i * 2)),
          ),
        },
      ],
    }),
  ),
  {
    id: "stack:prompt",
    recipe: "stack",
    note: "one question alone: a discussion prompt set large on a wash panel",
    fields: { question: 1 },
    fill: (n) => [H(n), { type: "question", text: n(1, 0) }],
  },
  // media
  ...(["media-right", "media-left"] as const).flatMap((r): Variant[] => [
    {
      id: `${r}:lead+points`,
      recipe: r,
      note: "text column: a lead and 2 points, beside a picture",
      fields: { lead: 1.2, point: 1 },
      fill: (n) => [
        H(n),
        { type: "text", text: n(1.2, 1) },
        { type: "points", items: [n(1, 4), n(1, 11)] },
        { type: "picture", picture: pic },
      ],
    },
    {
      id: `${r}:lead+3points`,
      recipe: r,
      note: "text column: a lead and 3 points, beside a picture",
      fields: { lead: 1.2, point: 1 },
      fill: (n) => [
        H(n),
        { type: "text", text: n(1.2, 1) },
        { type: "points", items: [n(1, 4), n(1, 11), n(1, 17)] },
        { type: "picture", picture: pic },
      ],
    },
    {
      id: `${r}:lead`,
      recipe: r,
      note: "text column: a lead sentence alone (or two), beside a diagram",
      fields: { lead: 1 },
      fill: (n) => [H(n), { type: "text", text: n(1, 1) }, { type: "picture", picture: pic }],
    },
    {
      id: `${r}:3questions`,
      recipe: r,
      note: "3 numbered questions beside a picture",
      fields: { question: 1 },
      fill: (n) => [
        H(n),
        ...[0, 1, 2].map((i): Block => ({ type: "question", text: n(1, 6 * i) })),
        { type: "picture", picture: pic },
      ],
    },
    {
      id: `${r}:lead+callout`,
      recipe: r,
      note: "a lead and a callout beside a diagram",
      fields: { lead: 1, callout: 1 },
      fill: (n) => [
        H(n),
        { type: "text", text: n(1, 1) },
        { type: "callout", text: n(1, 8) },
        { type: "picture", picture: pic },
      ],
    },
  ]),
  // big media
  {
    id: "big-media:caption",
    recipe: "big-media",
    note: "a picture or diagram across the band, one caption under it (2 lines at most)",
    fields: { caption: 1 },
    fill: (n) => [H(n), { type: "picture", picture: pic }, { type: "text", text: n(1, 2) }],
  },
  // compare
  ...[2, 3].flatMap((k): Variant[] => [
    {
      id: `compare:${k}cards`,
      recipe: "compare",
      note: `${k} cards side by side (label + text)`,
      fields: { label: k === 2 ? 20 : 14, text: 1 },
      fill: (n) => [
        H(n),
        ...Array.from(
          { length: k },
          (_, i): Block => ({
            type: "card",
            label: n(k === 2 ? 20 : 14, i * 4),
            text: n(1, i * 7),
          }),
        ),
      ],
    },
    {
      id: `compare:${k}picture-cards`,
      recipe: "compare",
      note: `${k} cards with a picture on top of each`,
      fields: { label: k === 2 ? 20 : 14, text: 1 },
      fill: (n) => [
        H(n),
        ...Array.from(
          { length: k },
          (_, i): Block => ({
            type: "card",
            label: n(k === 2 ? 20 : 14, i * 4),
            text: n(1, i * 7),
            picture: pic,
          }),
        ),
      ],
    },
    {
      id: `compare:lead+${k}cards`,
      recipe: "compare",
      note: `a lead line over ${k} cards`,
      fields: { lead: 1.5, label: k === 2 ? 20 : 14, text: 1 },
      fill: (n) => [
        H(n),
        { type: "text", text: n(1.5, 2) },
        ...Array.from(
          { length: k },
          (_, i): Block => ({
            type: "card",
            label: n(k === 2 ? 20 : 14, i * 4),
            text: n(1, i * 7),
          }),
        ),
      ],
    },
  ]),
  // sequence
  ...[2, 3, 4].map(
    (k): Variant => ({
      id: `sequence:${k}pictures`,
      recipe: "sequence",
      note: `${k} pictures in a row with arrows, a caption under each, and a lead line above`,
      fields: { lead: 2, caption: 1 },
      fill: (n) => [
        H(n),
        { type: "text", text: n(2, 1) },
        {
          type: "picture-sequence",
          items: Array.from({ length: k }, (_, i) => ({ picture: pic, caption: n(1, i * 5) })),
        },
      ],
    }),
  ),
  ...[3, 4].map(
    (k): Variant => ({
      id: `sequence:${k}cards`,
      recipe: "sequence",
      note: `${k} numbered step cards in a row (label + text)`,
      fields: { label: k === 3 ? 14 : 12, text: 1 },
      fill: (n) => [
        H(n),
        ...Array.from(
          { length: k },
          (_, i): Block => ({
            type: "card",
            label: n(k === 3 ? 14 : 12, i * 4),
            text: n(1, i * 7),
          }),
        ),
      ],
    }),
  ),
  // question + options
  ...[2, 3, 4].map(
    (k): Variant => ({
      id: `question-options:${k}`,
      recipe: "question-options",
      note: `a question and ${k} lettered options in a 2-column grid`,
      fields: { question: 60, option: 1 },
      fill: (n) => [
        H(n),
        { type: "question", text: n(60, 1) },
        { type: "options", items: Array.from({ length: k }, (_, i) => n(1, i * 6)) },
      ],
    }),
  ),
  {
    id: "question-options:3+picture",
    recipe: "question-options",
    note: "a question and 3 options in a column beside a picture or diagram",
    fields: { question: 40, option: 1 },
    fill: (n) => [
      H(n),
      { type: "question", text: n(40, 1) },
      { type: "options", items: [0, 1, 2].map((i) => n(1, i * 6)) },
      { type: "picture", picture: pic },
    ],
  },
];

/** The 2-line heading cap and the slide `n` would make, for a stage and N. */
export function headingCap(theme: Theme, stage: Stage): number {
  return withKeyStage(stage, () => {
    const z = blockSizes(theme, stage, 0);
    let best = 0;
    for (let n = 10; n <= 140; n += 2)
      if (
        countLines(
          filler(n, 3),
          "heading",
          theme,
          832 + 2 * resolveTextStyle({ preset: "heading" }, theme).padding,
          theme.weights.heading,
          z.heading,
        ) <= 2
      )
        best = n;
    return best;
  });
}

export function variantSlide(v: Variant, n: number, head: string): BlockSlide {
  // A weight of 10 or more is a fixed length in characters.
  const blocks = v.fill((w, seed) =>
    w === 0 ? head : filler(w >= 10 ? w : Math.max(4, Math.round(n * w)), seed),
  );
  return { recipe: v.recipe, blocks };
}

/** Does the variant at N fit at step 0 on every fit theme at `stage`? */
export function fitsAt(v: Variant, n: number, stage: Stage, head: string): boolean {
  return FIT_THEMES.every((id) => {
    const r = layoutBlocks(variantSlide(v, n, head), getTheme(id, stage), stage);
    return r.fits && r.step === 0 && r.faults.length === 0;
  });
}

/** Largest N (step 2) that fits; 0 when even the smallest does not. */
export function capacityOf(v: Variant, stage: Stage, head: string): number {
  let lo = 0;
  let hi = 400;
  if (!fitsAt(v, 8, stage, head)) return 0;
  lo = 8;
  while (hi - lo > 2) {
    const mid = Math.round((lo + hi) / 4) * 2;
    if (fitsAt(v, mid, stage, head)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Characters per line at width `w` in the body role (for the block table). */
export function charsPerLine(
  theme: Theme,
  stage: Stage,
  w: number,
  role: "body" | "lead" = "body",
): number {
  return withKeyStage(stage, () => {
    const z = blockSizes(theme, stage, 0);
    let best = 0;
    for (let n = 8; n <= 120; n += 1)
      if (
        countLines(
          filler(n, 1),
          "body",
          theme,
          w,
          role === "lead" ? 700 : theme.weights.body,
          z[role],
        ) <= 1
      )
        best = n;
    return best;
  });
}

export { typeScale };
