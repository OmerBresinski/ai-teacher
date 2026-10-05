import { describe, expect, test } from "bun:test";
import type { Slide, TextElement } from "@tj/domain/documents";
import { ACCENT_BAR_NAME, KIND_TAG_NAME } from "./look";
import { materialiseSlide } from "./materialise";
import type { SlideSpec } from "./specs";
import { THEMES } from "./themes";

/*
 * The simple slide (Greg, 5 Oct 2026: "simple is best"): a slide is its heading and its content.
 * No slide-type labels, no foot bar, no decorative markers (rulings 159, 160). The cover's
 * eyebrow and class line wait on Greg and stay.
 */
const META = { promptVersion: "test", model: "test", at: "2026-10-05T00:00:00.000Z" };
const counter = () => {
  let n = 0;
  return () => `e${++n}`;
};
const named = (slide: Slide, name: string) => slide.elements.filter((e) => e.name === name);
const plain = (el: TextElement) =>
  JSON.stringify(el.doc)
    .match(/"text":"([^"]*)"/g)
    ?.map((m) => m.slice(8, -1))
    .join("") ?? "";
const texts = (slide: Slide) =>
  slide.elements.filter((e): e is TextElement => e.type === "text").map(plain);

const SPECS: SlideSpec[] = [
  { kind: "title", title: "Coastal erosion", subtitle: "Year 9 · Geography", factRefs: [] },
  { kind: "starter", heading: "Do now", items: ["What is sediment?"], factRefs: [] },
  {
    kind: "exit-ticket",
    heading: "Exit ticket",
    items: ["Name one type of erosion.", "Why do cliffs retreat?"],
    factRefs: [],
  } as SlideSpec,
  {
    kind: "content",
    heading: "Hydraulic action widens cracks",
    body: "Hydraulic action is erosion by trapped air. Waves force air into cracks and squeeze it.",
    factRefs: ["k1"],
  },
  {
    kind: "true-false",
    statement: "Sound travels through a vacuum.",
    correct: false,
    explanation: "Sound needs particles to pass the vibration on.",
    factRefs: ["q1"],
  },
];

describe("simple: no chrome", () => {
  for (const theme of THEMES) {
    for (const spec of SPECS) {
      test(`${theme.id} ${spec.kind}: no kind tag and no foot bar`, () => {
        const slide = materialiseSlide(spec, theme.id, META, counter());
        expect(named(slide, KIND_TAG_NAME)).toHaveLength(0);
        expect(named(slide, ACCENT_BAR_NAME)).toHaveLength(0);
        expect(
          texts(slide).some((t) => /^(CHECK|STARTER|PRACTISE|THINK|TALK|REVIEW)$/.test(t)),
        ).toBe(false);
      });
    }
  }
});

describe("simple: the cover (ruling 162)", () => {
  for (const theme of THEMES) {
    test(`${theme.id}: the title alone on the theme's ground, no eyebrow, year line or rule`, () => {
      const slide = materialiseSlide(SPECS[0] as SlideSpec, theme.id, META, counter());
      expect(texts(slide)).toEqual(["Coastal erosion"]);
      expect(slide.elements.some((e) => e.type === "shape" && e.name === "Accent rule")).toBe(
        false,
      );
      expect(slide.background?.color).toBeUndefined();
    });
  }
});

describe("simple: question sets and the objectives are plain numbered lists (ruling 162)", () => {
  const long = [
    "Explain how passive resistance led the government to print more money in 1923.",
    "Why could hyperinflation harm a saver but help someone with a fixed debt in marks?",
    "Explain how ending passive resistance and the Rentenmark helped stabilise Germany.",
  ];
  const specs: SlideSpec[] = [
    { kind: "exit-ticket", heading: "Exit ticket", items: long, factRefs: [] } as SlideSpec,
    {
      kind: "starter",
      heading: "Quick check",
      items: long,
      footnote: `Answers: ${long.map((_, i) => `${i + 1} A full sentence that answers question ${i + 1} at length, as a teacher would.`).join("  ·  ")}`,
      factRefs: [],
    } as SlideSpec,
    {
      kind: "objectives",
      items: ["explain one thing", "compare two things"],
      factRefs: [],
    } as SlideSpec,
  ];
  for (const theme of THEMES) {
    for (const spec of specs) {
      test(`${theme.id} ${spec.kind}: no card, no disc, no reserved answer room`, () => {
        const slide = materialiseSlide(spec, theme.id, META, counter());
        expect(named(slide, "Row card")).toHaveLength(0);
        expect(slide.elements.some((e) => e.type === "shape" && e.shape === "ellipse")).toBe(false);
        const rows = slide.elements
          .filter(
            (e): e is TextElement =>
              e.type === "text" && /^(Row text|Row reveal|Objective \d)$/.test(e.name ?? ""),
          )
          .sort((a, b) => a.y - b.y);
        expect(rows.length).toBeGreaterThan(1);
        // Rows (and a hidden answer under its question) follow at a reading gap: no empty card room.
        let foot = (rows[0] as TextElement).y + (rows[0] as TextElement).h;
        for (const r of rows.slice(1)) {
          expect(r.y - foot).toBeLessThanOrEqual(48);
          foot = Math.max(foot, r.y + r.h);
        }
      });
    }
  }
});

describe("simple: an exit ticket keeps a natural rhythm (y1 s10)", () => {
  const items = [
    "What is a young cat called?",
    "A lamb goes with which adult? Tell one way they can look alike.",
    "Tell two ways a chick changes as it grows into a hen.",
  ];
  const answers = [
    "A kitten.",
    "A sheep. They can both have woolly coats.",
    "It gets bigger and grows feathers.",
  ];
  const spec = {
    kind: "exit-ticket",
    heading: "Exit ticket",
    items,
    footnote: `Answers: ${answers.map((a, i) => `${i + 1} ${a}`).join("  ·  ")}`,
    factRefs: [],
  } as SlideSpec;
  for (const theme of THEMES) {
    test(`${theme.id}: one fixed gap between items, the group at the top, not stretched`, () => {
      const slide = materialiseSlide(spec, theme.id, META, counter());
      const heading = named(slide, "Heading")[0] as TextElement;
      const qs = named(slide, "Row text").sort((a, b) => a.y - b.y) as TextElement[];
      const rs = named(slide, "Row reveal") as TextElement[];
      expect(qs).toHaveLength(3);
      // Every answer sits the same way (all beside or all under), so the rows read alike.
      const under = rs.map((r) => qs.some((q) => r.y > q.y && Math.abs(r.x - q.x) < 2));
      expect(new Set(under).size).toBe(1);
      // A row's foot is its question or the answer under it; the gap to the next row is fixed.
      const foot = (q: TextElement) =>
        Math.max(
          q.y + q.h,
          ...rs.filter((r) => r.y >= q.y && r.y < q.y + q.h + 12).map((r) => r.y + r.h),
        );
      const gaps = qs.slice(1).map((q, i) => q.y - foot(qs[i] as TextElement));
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(2);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(24);
      // The group starts under the heading and leaves the rest of the slide free.
      expect((qs[0] as TextElement).y - (heading.y + heading.h)).toBeLessThanOrEqual(48);
    });
  }
});

describe("simple: the hinge grid at body size (ruling 161)", () => {
  const mc = (texts: string[]) =>
    ({
      kind: "multiple-choice",
      stem: "Which explanation best links printing money to hyperinflation in 1923?",
      options: texts.map((text, i) => ({ text, correct: i === 1 })),
      explanation: "More money chased fewer goods.",
      factRefs: [],
    }) as SlideSpec;
  for (const theme of THEMES) {
    test(`${theme.id}: short options stay a 2×2 grid, set at body size`, () => {
      const slide = materialiseSlide(
        mc(["More money", "Fewer goods", "Lower taxes", "More coal"]),
        theme.id,
        META,
        counter(),
      );
      const opts = slide.elements.filter((e) => e.type === "option");
      expect(opts).toHaveLength(4);
      expect(new Set(opts.map((o) => o.x)).size).toBe(2);
      for (const o of opts) if (o.type === "option") expect(o.textStyle?.preset).toBe("body");
    });
  }
  for (const id of ["studio", "night-lab"])
    test(`${id}: y9's four sentence options (two lines in a card) are the grid`, () => {
      const slide = materialiseSlide(
        mc([
          "It created more goods for people to buy.",
          "It increased money while output fell.",
          "It cancelled Germany's reparations.",
          "It made the Ruhr produce more coal.",
        ]),
        id,
        META,
        counter(),
      );
      const opts = slide.elements.filter((e) => e.type === "option");
      expect(new Set(opts.map((o) => o.x)).size).toBe(2);
    });
  test("long options take the single column", () => {
    const long =
      "Printing more money while output fell meant more marks chased fewer goods, so prices kept rising";
    const slide = materialiseSlide(mc([long, long, long, long]), "studio", META, counter());
    const opts = slide.elements.filter((e) => e.type === "option");
    expect(new Set(opts.map((o) => o.x)).size).toBe(1);
  });
});

describe("simple: the open response is a question at the top, its parts on their own lines", () => {
  const or = (stem: string) =>
    materialiseSlide(
      { kind: "open-response", stem, factRefs: [] } as SlideSpec,
      "studio",
      META,
      counter(),
    );
  test("no floating box: the question opens the slide", () => {
    const slide = or("How does a chick change as it grows into a hen?");
    expect(slide.elements.some((e) => e.name === "Prompt card")).toBe(false);
    const q = slide.elements.find((e): e is TextElement => e.type === "text");
    expect(q?.y).toBe(43);
    expect(q?.style.align ?? "left").toBe("left");
  });
  test("a three-part question sets (a), (b) and (c) on their own lines", () => {
    const slide = or(
      "How did Germany's hyperinflation develop, why did its effects differ, and how was it brought under control?",
    );
    const parts = slide.elements.filter((e) => e.name === "Part");
    expect(parts.map((p) => (p.type === "text" ? plain(p) : ""))).toEqual([
      "(a)\u2003How did Germany's hyperinflation develop?",
      "(b)\u2003Why did its effects differ?",
      "(c)\u2003How was it brought under control?",
    ]);
    for (let i = 1; i < parts.length; i++)
      expect((parts[i] as TextElement).y).toBeGreaterThan((parts[i - 1] as TextElement).y);
  });
  test("written parts keep their marks, right-aligned on the part's line", () => {
    const slide = or("Answer in full. (a) Name the gas. [1] (b) Explain why it rises. [3]");
    const marks = slide.elements.filter((e): e is TextElement => e.name === "Marks");
    expect(marks.map(plain)).toEqual(["[1]", "[3]"]);
    for (const m of marks) expect(m.style.align).toBe("right");
  });
});

describe("simple: the two-sided contrast (item 6)", () => {
  const cmp = (l: string, r: string) =>
    ({
      kind: "content",
      heading: "Who lost, and who could gain?",
      body: "Prices rose faster than most incomes.",
      compare: {
        left: {
          label: l,
          points: ["Savers: money bought less and less", "Workers: wages lagged prices"],
        },
        right: {
          label: r,
          points: ["Borrowers: debts in marks shrank", "Landowners kept real wealth"],
        },
      },
      factRefs: [],
    }) as SlideSpec;
  for (const theme of THEMES) {
    test(`${theme.id}: lost vs gained is two soft tinted columns, red and green, no outline`, () => {
      const slide = materialiseSlide(cmp("Lost out", "Could gain"), theme.id, META, counter());
      const cards = slide.elements.filter((e) => e.name === "Compare card");
      expect(cards).toHaveLength(2);
      const [a, b] = cards as Extract<(typeof cards)[number], { type: "shape" }>[];
      expect(a?.strokeWidth ?? 0).toBe(0);
      expect(a?.fill).not.toBe(b?.fill);
      const labels = slide.elements.filter((e): e is TextElement => e.name === "Compare label");
      expect(labels.map((l) => l.style.color)).toEqual([
        theme.colors.incorrect,
        theme.colors.correct,
      ]);
    });
  }
  test("a contrast without a gain/loss meaning takes no red or green", () => {
    const t = THEMES.find((x) => x.id === "studio") as (typeof THEMES)[number];
    const slide = materialiseSlide(cmp("Weather", "Climate"), "studio", META, counter());
    const labels = slide.elements.filter((e): e is TextElement => e.name === "Compare label");
    expect(labels).toHaveLength(2);
    for (const l of labels)
      expect([t.colors.incorrect, t.colors.correct]).not.toContain(l.style.color);
  });
});
