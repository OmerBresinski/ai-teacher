import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";

/*
 * UX ruling 203, P9 (TEACH-75 part g): 3 to 5 steps with no figure are a numbered process line,
 * discs on one line, a bold label (the words before a step's first colon) and a centred body.
 * Anything it cannot hold is the numbered list as before, so capacity never drops.
 */
type El = { name?: string; doc?: unknown; style?: { align?: string; fontWeight?: number } };
const steps = (n: number, long = false): TemplateInput => ({
  template: "steps",
  heading: "How blood travels",
  points: Array.from({ length: n }, (_, k) =>
    long
      ? `Step ${k + 1}: ${"the blood goes round and round the body again ".repeat(3)}`
      : `Stage ${k + 1}: blood moves on to the next part.`,
  ),
});
const words = (e: El | undefined) => JSON.stringify(e?.doc).match(/"text":"([^"]*)"/)?.[1];

describe("steps as a process line", () => {
  test("3, 4 and 5 steps fit as a line on every theme at every stage", () => {
    for (const stage of ["ks1", "ks2", "ks3"] as Stage[])
      for (const theme of THEMES)
        for (const n of [3, 4, 5]) {
          const r = layoutTemplate(steps(n), theme, stage);
          const els = r.slide.elements as El[];
          expect({ stage, theme: theme.id, n, over: r.over }).toEqual({
            stage,
            theme: theme.id,
            n,
            over: [],
          });
          const line = els.some((e) => e.name === "Process line");
          // KS1's large type may not hold 5 in a row: then it is the list, never over.
          if (!(stage === "ks1" && n === 5))
            expect({ stage, theme: theme.id, n, line }).toMatchObject({ line: true });
          if (!line) continue;
          expect(els.filter((e) => e.name === "Marker")).toHaveLength(n);
          const labels = els.filter((e) => e.name === "Step label");
          expect(labels.map(words)).toEqual(Array.from({ length: n }, (_, k) => `Stage ${k + 1}`));
          for (const l of labels) expect(l.style?.align).toBe("center");
        }
  });

  test("2 steps, a figure, or steps too long for a column stay the numbered list", () => {
    const theme = THEMES[0] as (typeof THEMES)[number];
    const has = (input: TemplateInput) =>
      (layoutTemplate(input, theme, "ks2").slide.elements as El[]).some(
        (e) => e.name === "Process line",
      );
    expect(has(steps(2))).toBe(false);
    expect(has(steps(4, true))).toBe(false);
    expect(
      has({
        ...steps(4),
        figure: { diagram: { kind: "flow", alt: "x", steps: [{ label: "a" }, { label: "b" }] } },
      }),
    ).toBe(false);
  });

  test("a step with no colon has no label, only its body", () => {
    const els = layoutTemplate(
      { template: "steps", heading: "Tea", points: ["Boil the water.", "Pour it in.", "Wait."] },
      THEMES[0] as (typeof THEMES)[number],
      "ks2",
    ).slide.elements as El[];
    expect(els.some((e) => e.name === "Step label")).toBe(false);
    expect(els.filter((e) => e.name === "Item").map(words)).toEqual([
      "Boil the water.",
      "Pour it in.",
      "Wait.",
    ]);
  });

  test("never throws on odd steps", () => {
    for (const theme of THEMES)
      for (const points of [
        [":", ": :", "::x"],
        ["a:b", "", " "],
        Array.from({ length: 5 }, () => "x".repeat(200)),
      ]) {
        const r = layoutTemplate({ template: "steps", heading: "", points }, theme, "ks2");
        expect(Array.isArray(r.slide.elements)).toBe(true);
      }
  });
});
