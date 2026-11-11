import { describe, expect, test } from "bun:test";
import { countLines } from "../text-measure";
import { getTheme } from "../themes";
import { FORMULA_FLOOR, layoutTemplate } from "./index";

// The equation slide sets its formula on one line, stepping down to a floor, and past the floor
// breaks before its arrow or equals sign, never inside a side (e2e-11nov proof, y8 s3).
const NB = " ";
const base = {
  template: "equation-hero" as const,
  heading: "The photosynthesis word equation",
  lead: "Photosynthesis makes glucose in chloroplasts in plant cells.",
  points: ["Light provides the energy needed for photosynthesis."],
};
type El = {
  name?: string;
  w: number;
  h: number;
  style: { fontSize: number };
  doc: { content: { content: { type: string; text?: string }[] }[] };
};
const formulaOf = (formula: string, theme = "studio") => {
  const t = getTheme(theme);
  const r = layoutTemplate({ ...base, formula }, t, "ks3");
  const e = (r.slide.elements as unknown as El[]).find((x) => x.name === "Formula") as El;
  const nodes = e.doc.content[0]?.content ?? [];
  const lines = nodes.filter((n) => n.type === "text").map((n) => n.text as string);
  return { r, e, t, lines, breaks: nodes.filter((n) => n.type === "hardBreak").length };
};
const display = layoutTemplate({ ...base, formula: "x = 5" }, getTheme("studio"), "ks3");
const full = (display.slide.elements as unknown as El[]).find((x) => x.name === "Formula")?.style
  .fontSize as number;

describe("equation slide formula: one line, stepped down, else broken before the relation", () => {
  test("a short formula stays at the display size on one line", () => {
    const { e, lines, breaks, r } = formulaOf("speed = distance/time");
    expect(e.style.fontSize).toBe(full);
    expect(lines).toEqual([`speed =${NB}distance/time`]);
    expect(breaks).toBe(0);
    expect(r.over).toEqual([]);
  });

  test("the photosynthesis word equation steps down to fit one line (was 2 lines at full size)", () => {
    const { e, t, lines, breaks, r } = formulaOf("carbon dioxide + water → glucose + oxygen");
    expect(breaks).toBe(0);
    expect(e.style.fontSize).toBeLessThan(full);
    expect(e.style.fontSize).toBeGreaterThanOrEqual(full * FORMULA_FLOOR);
    const one = (size: number) =>
      countLines(lines[0] as string, "heading", t, e.w, t.weights.heading, size, true);
    expect(one(full)).toBe(2); // the old size broke it
    expect(one(e.style.fontSize)).toBe(1);
    expect(one(e.style.fontSize + 2)).toBe(2); // the largest 2 pt step that fits
    expect(e.h).toBe(Math.ceil(e.style.fontSize * 1.12)); // one line tall
    expect(r.over).toEqual([]);
  });

  test("too long for one line at the floor: breaks before the arrow, each side whole", () => {
    const { e, t, lines, breaks, r } = formulaOf(
      "magnesium + hydrochloric acid → magnesium chloride + hydrogen",
    );
    expect(breaks).toBe(1);
    expect(lines).toEqual([`magnesium +${NB}hydrochloric acid`, "→ magnesium chloride + hydrogen"]);
    for (const l of lines)
      expect(countLines(l, "heading", t, e.w, t.weights.heading, e.style.fontSize, true)).toBe(1);
    expect(r.over).toEqual([]);
  });

  test("breaks before an equals sign, and only before relations", () => {
    const { lines, breaks } = formulaOf(
      "the total energy stored in the bonds of glucose = the light energy the leaf absorbs",
    );
    expect(breaks).toBe(1);
    expect(lines[1]?.startsWith("=")).toBe(true);
    expect(lines[0]).toBe("the total energy stored in the bonds of glucose");
  });

  test("a side that cannot fit even at the floor is marked over, never split silently", () => {
    const { r, breaks, e } = formulaOf(
      "the total amount of energy stored in the chemical bonds of all the glucose made = the amount of light energy absorbed by every leaf on the plant",
    );
    expect(breaks).toBe(1);
    expect(e.style.fontSize).toBe(Math.round(full * FORMULA_FLOOR * 10) / 10);
    expect(r.over.some((o) => o.startsWith("formula side wraps"))).toBe(true);
  });
});
