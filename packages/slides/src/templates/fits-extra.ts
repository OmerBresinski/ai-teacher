/**
 * The writer's Fits rows for item counts the writer schema allows but the catalogue never measured
 * (#431, prompt option `clarity`): a 2-option hinge, 1 or 2 questions (with and without a picture),
 * 2 steps, a formula with 1 line, a lead with 1 plain point, and the largest counts with a picture
 * (4 questions, 5 steps, a formula with 4 lines) where a stage's schema allows them. Measured exactly as `capacity.ts`
 * measures the catalogue (same templates, sample words, themes and stages as
 * `scripts/catalogue.ts`), so a generated row is as true as a pinned one. Regenerate with
 * `bun packages/slides/scripts/fits-extra.ts`.
 */

import { getTheme } from "../themes";
import { measureTemplate, TEMPLATE_DOCS, type TemplateDoc } from "./capacity";
import type { Stage } from "./index";

type Variant = TemplateDoc["variants"][number];
const q = (n: number) => `${n} question${n > 1 ? "s" : ""}`;

/** The extra fills, by writer layout: the renderer template measured and its variants. */
export const EXTRA_FITS: Record<string, { template: string; variants: Variant[] }> = {
  // All three counts: the pinned hinge rows were measured on the lab's older 2x2 grid (3 options
  // in half-width cells); today's template lays 2 or 3 options in one row, so every row is re-measured.
  hinge: {
    template: "hinge",
    variants: [2, 3, 4].map((n) => ({ label: `${n} options`, counts: { options: n } })),
  },
  ...Object.fromEntries(
    (["question-set", "practice"] as const).map((id) => [
      id,
      {
        template: id,
        variants: [
          ...[1, 2].flatMap((n): Variant[] => [
            { label: q(n), counts: { questions: n } },
            { label: `${q(n)} with picture`, counts: { questions: n }, figure: "photo" },
          ]),
          { label: `${q(4)} with picture`, counts: { questions: 4 }, figure: "photo" },
        ],
      },
    ]),
  ),
  "exit-ticket": {
    template: "exit-ticket",
    variants: [1, 2].map((n) => ({ label: q(n), counts: { questions: n } })),
  },
  steps: {
    template: "steps",
    variants: [
      { label: "2 steps", counts: { points: 2 } },
      { label: "2 steps with figure", counts: { points: 2 }, figure: "photo" },
      { label: "5 steps with figure", counts: { points: 5 }, figure: "photo" },
    ],
  },
  "equation-hero": {
    template: "equation-hero",
    variants: [
      { label: "formula + 1 line", counts: { points: 1 } },
      { label: "formula + 1 line with figure", counts: { points: 1 }, figure: "photo" },
      { label: "formula + 4 lines with figure", counts: { points: 4 }, figure: "photo" },
    ],
  },
  explain: { template: "explain", variants: [{ label: "lead + 1 point", counts: { points: 1 } }] },
  // visual-text's Fits come from picture-text (its diagram twin measures the same).
  "visual-text": {
    template: "picture-text",
    variants: [{ label: "lead + 1 point", counts: { points: 1 }, figure: "photo" }],
  },
};

/** The catalogue's stages and themes (`scripts/catalogue.ts`). */
export const FIT_STAGES = [
  { key: "KS1", stage: "ks1", theme: "splash" },
  { key: "KS2", stage: "ks2", theme: "splash" },
  { key: "KS3-5", stage: "ks3", theme: "studio" },
] as const;

export type ExtraFits = Record<
  string,
  Record<
    string,
    {
      charsPerLine: number;
      variants: {
        label: string;
        counts: Record<string, number>;
        figure: boolean;
        maxCharsPerItem: number;
      }[];
    }
  >
>;

/** Measures every extra fill at every stage: stage key → writer layout → body line and variants. */
export function measureExtraFits(): ExtraFits {
  const out: ExtraFits = {};
  for (const { key, stage, theme } of FIT_STAGES) {
    const byLayout: ExtraFits[string] = {};
    for (const [layout, { template, variants }] of Object.entries(EXTRA_FITS)) {
      const doc = TEMPLATE_DOCS.find((d) => d.id === template);
      if (!doc) throw new Error(`no template ${template}`);
      // The doc's own variants first, so the column width (charsPerLine) is measured as the catalogue's.
      const c = measureTemplate(
        { ...doc, variants: [...doc.variants, ...variants] },
        getTheme(theme),
        stage as Stage,
      );
      byLayout[layout] = {
        charsPerLine: c.charsPerLine.body as number,
        variants: c.variants.slice(doc.variants.length).map((v, i) => ({
          label: v.label,
          counts: v.counts,
          figure: !!variants[i]?.figure,
          maxCharsPerItem: v.maxCharsPerItem,
        })),
      };
    }
    out[key] = byLayout;
  }
  return out;
}
