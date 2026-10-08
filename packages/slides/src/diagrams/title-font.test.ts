import { describe, expect, it } from "bun:test";
import { THEMES } from "../themes";
import { renderDiagram } from ".";
import { context, family, titleCtx, wrap } from "./svg";

/* lab/cand: a diagram's title is drawn in the theme's heading family and measured with that
   family's advances, so its line breaks are the ones the browser draws. */
const spec = (title: string) => ({
  kind: "flow",
  alt: "A chick grows into a hen.",
  layout: "chain",
  title,
  steps: [{ label: "Chick", arrow: "grows" }, { label: "Young chicken" }, { label: "Hen" }],
});
const TITLE = "From a fluffy chick to an adult hen";
const titleLines = (svg: string) => {
  const first = /<text [^>]*>(.*?)<\/text>/.exec(svg)?.[1] ?? "";
  return [...first.matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g)].map((m) => m[1]);
};

let differs = 0;
describe("diagram title in the heading font", () => {
  for (const t of THEMES.filter((t) => t.fonts.title !== t.fonts.body)) {
    it(`names and measures the title in ${t.id}'s heading family`, () => {
      const x = context(t, 600, 300);
      const svg = renderDiagram(spec(TITLE), t, { w: 600, h: 300 }) as string;
      expect(svg).toContain(`font-family="${family(t.fonts.title)}"`);
      // Some width breaks the title differently in the two families: there, the drawing follows
      // the heading family.
      for (let w = 200; w <= 700; w += 10) {
        const big = Math.round(context(t, w, 300).fs * 1.1);
        const head = wrap(TITLE, titleCtx(context(t, w, 300)), w, 2, big, 700);
        const bodyM = wrap(TITLE, context(t, w, 300), w, 2, big, 700);
        if (head.join("|") === bodyM.join("|") || head.some((l) => l.endsWith("…"))) continue;
        differs++;
        const drawn = renderDiagram(spec(TITLE), t, { w, h: 300 }) as string;
        expect(titleLines(drawn)).toEqual(head);
      }
      expect(x.fs).toBeGreaterThan(0);
    });
  }
  it("some width breaks the title differently in the two families (the check above bites)", () => {
    expect(differs).toBeGreaterThan(0);
  });
  it("the heading measure differs from the body measure on a theme with two families", () => {
    const t = THEMES.find((t) => t.id === "splash") ?? THEMES[0];
    if (!t) throw new Error("no theme");
    const x = context(t, 600, 300);
    expect(wrap(TITLE, titleCtx(x), 10_000, 1, 30, 700)).toEqual([TITLE]);
    expect(titleCtx(x).stack).toBe(t.fonts.title);
    expect(titleCtx(x).body).toBe(family(t.fonts.title));
  });
});
