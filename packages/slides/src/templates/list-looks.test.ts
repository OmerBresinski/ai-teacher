import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { layoutTemplate, type Stage } from "./index";
import { verbSplit } from "./list-looks";

// The objectives room the writer is held to (generation/src/writer/objectives-room.gen.json):
// every look must hold the measured capacity, at every count, without spilling off the slide.
const ROOM: [Stage, number, number][] = [
  ["ks1", 2, 124],
  ["ks1", 3, 48],
  ["ks1", 4, 44],
  ["ks2", 2, 144],
  ["ks2", 3, 100],
  ["ks2", 4, 54],
  ["ks3", 2, 224],
  ["ks3", 3, 118],
  ["ks3", 4, 64],
];
const THEMES = ["paper", "splash", "studio", "dark-slate"];
const words = (n: number) =>
  `Explain ${"how plates move apart and magma rises through the crust to the surface ".repeat(6)}`
    .slice(0, n)
    .trim();
const PHOTO = { photo: "/x.jpg", aspect: 1.5, alt: "x" };

const inside = (els: { x: number; y: number; w: number; h: number }[]) =>
  els.every((e) => e.x >= 0 && e.y >= 0 && e.x + e.w <= 960.5 && e.y + e.h <= 540.5);

describe("objectives looks (lane OBJ)", () => {
  test("verbSplit takes the command verb", () => {
    expect(verbSplit("Explain how magma rises")).toEqual(["Explain", "how magma rises"]);
    expect(verbSplit("Explain")).toEqual(["Explain", ""]);
  });

  for (const look of ["goals", "picture", "journey"] as const)
    for (const [stage, n, chars] of ROOM)
      for (const theme of THEMES)
        test(`${look} holds ${n} x ${chars} chars at ${stage} in ${theme}`, () => {
          const t = getTheme(theme, stage);
          const points = Array.from({ length: n }, () => words(chars));
          const r = layoutTemplate(
            { template: "objectives", heading: "Today we are learning to", points, figure: PHOTO },
            t,
            stage,
            { objectivesLook: look },
          );
          const names = r.slide.elements.map((e) => e.name);
          // Drawn by the look (verbs), not by the old numbered list.
          expect(names.filter((x) => x === "Verb" || x === "Item").length).toBeGreaterThanOrEqual(
            n,
          );
          if (look !== "picture") expect(names.filter((x) => x === "Verb").length).toBe(n);
          expect(inside(r.slide.elements)).toBe(true);
          expect(r.over).toEqual([]);
        });
});

describe("starter looks (lane OBJ)", () => {
  for (const look of ["cards", "picture"] as const)
    for (const stage of ["ks1", "ks2", "ks3"] as Stage[])
      test(`${look} at ${stage}: answers reveal one click each`, () => {
        const r = layoutTemplate(
          {
            template: "question-set",
            heading: "What does your body need?",
            questions: [
              "What happens to your breathing when running?",
              "What do you breathe into your lungs?",
              "Why does your body need food?",
            ],
            answers: ["Faster and deeper", "Oxygen", "Energy to grow and repair"],
            figure: PHOTO,
          },
          getTheme("paper", stage),
          stage,
          { starterLook: look },
        );
        // A look that cannot hold them (KS1 type) falls back to the quick check, which reveals too.
        const steps = new Set(r.slide.elements.map((e) => e.revealStep ?? 0).filter((x) => x > 0));
        // KS1 type is too large for three cards: the slide falls back to the production drawing.
        if (stage === "ks1")
          expect(r.slide.elements.some((e) => e.name === "Answer" && e.revealStep)).toBe(false);
        else expect([...steps].sort()).toEqual([1, 2, 3]);
        expect(inside(r.slide.elements)).toBe(true);
      });
});

test("off by default: no look, the slide is as before", () => {
  const t = getTheme("paper", "ks2");
  const r = layoutTemplate(
    {
      template: "objectives",
      heading: "Today we are learning to",
      points: ["Explain why", "Name parts"],
    },
    t,
    "ks2",
  );
  expect(r.slide.elements.some((e) => e.name === "Verb")).toBe(false);
});
