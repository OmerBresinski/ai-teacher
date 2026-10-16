import { describe, expect, test } from "bun:test";
import type { Theme } from "@tj/domain/documents";
import { contrastRatio } from "../look";
import { resolveTextStyle } from "../text-style";
import { THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateId } from "./index";
import { templateSamples } from "./samples";

/*
 * TEACH-75 part ap: a pilot layout is laid out on one theme and may be drawn on another (the dry
 * run laid Night Lab lessons out in Splash's colours, and the split-compare heading took Night
 * Lab's pale ink on Splash's pale ground: 1.08:1). A layout that paints its own ground owns its
 * inks too: every word in it reads on what is under it, on whichever theme the deck is drawn in.
 * WCAG AA: 4.5:1, or 3:1 for large text (24 px, or 18.66 px bold).
 */
const TEMPLATES: TemplateId[] = ["split-compare", "panel-list", "items-row"];
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];

type El = {
  type: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  style?: Record<string, unknown>;
  textStyle?: Record<string, unknown>;
  doc?: unknown;
};

/** The fill under the middle of `e`: the last shape drawn before it that covers that point. */
function under(els: El[], i: number, ground: string): string {
  const e = els[i] as El;
  const cx = e.x + e.w / 2;
  const cy = e.y + Math.min(e.h, 40) / 2;
  for (let j = i - 1; j >= 0; j--) {
    const b = els[j] as El;
    if (b.type !== "shape" || !b.fill || b.fill === "transparent") continue;
    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) return b.fill;
  }
  return ground;
}

/** Every word in a laid-out slide that reads under `need`, drawn in the deck theme `deck`. */
function faults(els: El[], deck: Theme): string[] {
  const out: string[] = [];
  els.forEach((e, i) => {
    const style = e.type === "text" ? e.style : e.doc ? e.textStyle : undefined;
    if (!style) return;
    const r = resolveTextStyle(style, deck, "body");
    // Words on a shape (a marker's label) sit on that shape's own fill.
    const back = e.type === "shape" && e.fill ? e.fill : under(els, i, deck.colors.background);
    const large = r.fontSize >= 24 || (r.fontSize >= 18.66 && r.fontWeight >= 700);
    const need = large ? 3 : 4.5;
    const ratio = contrastRatio(r.color, back);
    if (ratio < need) out.push(`${e.name}: ${r.color} on ${back} ${ratio.toFixed(2)}:1`);
  });
  return out;
}

describe("a layout's words read on its own ground, on every theme", () => {
  for (const template of TEMPLATES)
    for (const theme of THEMES)
      test(`${template} laid out on ${theme.id}, drawn on every theme`, () => {
        const found: string[] = [];
        for (const input of templateSamples().filter((s) => s.template === template))
          for (const stage of STAGES) {
            const els = layoutTemplate(input, theme, stage).slide.elements as unknown as El[];
            for (const deck of THEMES)
              for (const f of faults(els, deck)) found.push(`${stage} on ${deck.id}: ${f}`);
          }
        expect(found).toEqual([]);
      });
});
