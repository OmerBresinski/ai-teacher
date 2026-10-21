import { describe, expect, test } from "bun:test";
import type { SlideElement, TextElement } from "@tj/domain/documents";
import { contrastRatio } from "../look";
import { atKeyStage, getTheme, MIN_FONT_SIZE, THEMES } from "../themes";
import { surfaceStyle, surfacesOf } from "../themes/surfaces";
import { EXIT_LABEL, TICKET } from "./exit-ticket";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import {
  AGES,
  type Age,
  capOf,
  colOptions,
  isCalc,
  PRACTICE_MAX,
  splitPractice,
  WA,
  WA_NAMES,
  type WorkVariant,
} from "./practice";
import { measureWorkCap, VARIANT_COUNTS, workFits, workSample } from "./practice-capacity";
import { WORK_CASES } from "./practice-fixtures";

const paper = getTheme("paper");
const lay = (input: TemplateInput, stage: Stage, theme = paper) =>
  layoutTemplate(input, theme, stage);
const texts = (els: SlideElement[]) =>
  els.filter((e): e is TextElement => e.type === "text").map((e) => JSON.stringify(e.doc));
const named = (els: SlideElement[], name: string) => els.filter((e) => e.name === name);
const caseOf = (name: string) => WORK_CASES.find((k) => k.name === name) as (typeof WORK_CASES)[0];

describe("the gold's cases (northstars-v13/practice-exit)", () => {
  const fits = WORK_CASES.filter((k) => /-static$|-failed$/.test(k.name));
  for (const k of fits)
    test(`${k.name}: fits on every theme, nothing under the floor, nothing past the foot`, () => {
      for (const t of THEMES) {
        const r = lay(k.input, k.stage, t);
        expect(r.over).toEqual([]);
        for (const e of r.slide.elements) {
          const size =
            (e as TextElement).style?.fontSize ??
            (e as { textStyle?: { fontSize?: number } }).textStyle?.fontSize;
          if (size !== undefined) expect(size).toBeGreaterThanOrEqual(MIN_FONT_SIZE.body);
          if (e.name !== WA_NAMES.floor) expect(e.y + e.h).toBeLessThanOrEqual(540);
        }
      }
    });

  test("over the max is flagged, never squeezed: 7 tasks and 4 exit questions", () => {
    expect(lay(caseOf("practice-ks2-over7-over").input, "ks2").over[0]).toContain("7/6");
    expect(lay(caseOf("exit-ks2-over4-over").input, "ks2").over[0]).toContain("4/3");
  });
});

describe("practice", () => {
  test("column options follow the gold: one row at 2-3, 2x2 at 4, calculations 3 across", () => {
    expect(colOptions(["a", "b"])).toEqual([2, 1]);
    expect(colOptions(["a", "b", "c", "d"])).toEqual([2]);
    expect(colOptions(["1 + 2", "3 + 4", "5 + 6", "7 + 8", "9 + 1"])).toEqual([3, 2]);
    expect(colOptions(["a", "b", "c", "d", "e", "f"])).toEqual([2, 3]);
    expect(isCalc("3,456 + 2,789")).toBe(true);
    expect(isCalc("Find 1/6 of 42.")).toBe(false);
  });

  test("six column sums sit three across, each on one line", () => {
    const r = lay(caseOf("practice-ks2-maths6-static").input, "ks2");
    const tasks = named(r.slide.elements, WA_NAMES.task);
    expect(new Set(tasks.map((t) => t.x)).size).toBe(3);
    for (const t of tasks) expect(t.h).toBeLessThan(((t as TextElement).style.fontSize ?? 0) * 2);
  });

  test("the where line (instruction) is kept in the data and never drawn; no answers are drawn", () => {
    const k = caseOf("practice-ks2-tf-static");
    const input = { ...k.input, instruction: "Write true or false in your book" };
    const r = lay(input, "ks2");
    const all = texts(r.slide.elements).join(" ");
    expect(all).not.toContain("Write true or false");
    expect(all).not.toContain("False");
    // The answers stay on the slide's data for the end-of-deck Answers slides (ruling 231).
    expect(r.slide.question?.type).toBe("open-response");
  });

  test("a picture sits in a white card on the left, the tasks stack on the right", () => {
    const r = lay(caseOf("practice-ks1-picture-static").input, "ks1");
    const card = named(r.slide.elements, WA_NAMES.card)[0] as SlideElement;
    const photo = named(r.slide.elements, "Photo")[0] as SlideElement;
    expect(card.x).toBe(64);
    expect(photo.x).toBeGreaterThan(card.x);
    expect(photo.x + photo.w).toBeLessThanOrEqual(card.x + card.w);
    for (const t of named(r.slide.elements, WA_NAMES.task))
      expect(t.x).toBeGreaterThan(card.x + card.w);
  });

  test("a failed picture keeps a 4:3 card with its caption, centred", () => {
    const r = lay(caseOf("practice-ks1-picture-failed").input, "ks1");
    const card = named(r.slide.elements, WA_NAMES.card)[0] as SlideElement;
    expect(Math.abs(card.w / card.h - 4 / 3)).toBeLessThan(0.02);
    expect(named(r.slide.elements, "Photo")).toHaveLength(0);
    const cap = named(r.slide.elements, WA_NAMES.caption)[0] as TextElement;
    expect(JSON.stringify(cap.doc)).toContain("A cow standing in a field");
    expect(cap.style.align).toBe("center");
  });

  test("more than 6 tasks split onto a second practice slide, never one task alone", () => {
    const qs = Array.from({ length: 7 }, (_, i) => `Task ${i + 1}`);
    const parts = splitPractice({
      template: "practice",
      heading: "Sums",
      questions: qs,
      answers: qs,
    });
    expect(parts.map((p) => p.questions?.length)).toEqual([5, 2]);
    expect(parts[1]?.answers).toEqual(["Task 6", "Task 7"]);
    const ten = splitPractice({
      template: "practice",
      heading: "Sums",
      questions: [...qs, "a", "b", "c"],
    });
    expect(ten.map((p) => p.questions?.length)).toEqual([6, 4]);
    for (const p of ten) expect(lay(p, "ks2").over).toEqual([]);
    const pic = splitPractice({
      template: "practice",
      heading: "Cows",
      questions: qs.slice(0, 6),
      figure: { photo: "https://x.test/c.jpg", aspect: 4 / 3 },
    });
    expect(pic.map((p) => p.questions?.length)).toEqual([4, 2]);
    expect(pic[1]?.figure).toBeUndefined();
    expect(
      splitPractice({ template: "practice", heading: "x", questions: qs.slice(0, PRACTICE_MAX) }),
    ).toHaveLength(1);
  });
});

describe("exit ticket", () => {
  test("a centred title, a centred ticket on a sand floor that rises behind its middle", () => {
    const r = lay(caseOf("exit-ks2-3-static").input, "ks2");
    const head = named(r.slide.elements, "Heading")[0] as TextElement;
    expect(head.style.align).toBe("center");
    const ticket = named(r.slide.elements, WA_NAMES.card)[0] as SlideElement;
    expect(ticket.x + ticket.w / 2).toBe(480);
    expect(ticket.w).toBe(TICKET.w);
    const floor = named(r.slide.elements, WA_NAMES.floor)[0] as SlideElement;
    expect(floor.x).toBe(0);
    expect(floor.w).toBe(960);
    expect(floor.y + floor.h).toBe(540);
    expect(Math.abs(floor.y - (ticket.y + ticket.h * 0.4))).toBeLessThanOrEqual(1);
    // Painted first: the floor, then the ticket, then its words.
    const order = r.slide.elements.map((e) => e.name);
    expect(order.indexOf(WA_NAMES.floor)).toBeLessThan(order.indexOf(WA_NAMES.card));
  });

  test('the kicker reads "EXIT TICKET" in the accent, the slide\'s one accent mark', () => {
    const r = lay(caseOf("exit-ks1-2-static").input, "ks1");
    const kick = named(r.slide.elements, WA_NAMES.kicker)[0] as TextElement;
    expect(JSON.stringify(kick.doc)).toContain(EXIT_LABEL.toUpperCase());
    expect(kick.style.color).toBe(atKeyStage(paper, "ks1").colors.accent);
  });

  test("questions stack inside under hairlines; no answers on the slide", () => {
    const k = caseOf("exit-ks2-3-static");
    const r = lay(k.input, "ks2");
    expect(named(r.slide.elements, WA_NAMES.rule)).toHaveLength(3);
    expect(named(r.slide.elements, WA_NAMES.badge)).toHaveLength(3);
    expect(texts(r.slide.elements).join(" ")).not.toContain('"24"');
    expect(r.slide.question).toEqual({ type: "open-response", modelAnswer: "1. 7\n2. 24\n3. 12" });
  });
});

describe("theme roles", () => {
  test("the sand floor is square on every theme (its own corner), on the slide", () => {
    for (const t of THEMES) {
      const r = lay(caseOf("exit-ks2-3-static").input, "ks2", t);
      const floor = named(r.slide.elements, WA_NAMES.floor)[0];
      if (!floor) continue;
      expect(floor.type === "shape" && floor.shape).toBe("rect");
      expect(floor.x).toBe(0);
      expect(floor.x + floor.w).toBe(960);
    }
  });

  test("badges, rules, cards and the floor are painted through the theme's surface roles, AA on badges", () => {
    for (const t of THEMES)
      for (const k of [caseOf("exit-ks2-3-static"), caseOf("practice-ks1-picture-static")]) {
        const r = lay(k.input, k.stage, t);
        for (const b of named(r.slide.elements, WA_NAMES.badge)) {
          const st = surfaceStyle(t, "badge");
          // An outline badge (Scrapbook, TEACH-215 part k) is a clear ring: it paints the ground.
          const fill = st.fill === "transparent" ? surfacesOf(t).ground : st.fill;
          expect(b.type === "shape" && b.fill).toBe(fill);
          expect(contrastRatio(st.ink ?? "#000", fill)).toBeGreaterThanOrEqual(4.5);
        }
        expect(r.slide.elements.some((e) => e.name?.startsWith("surface:card"))).toBe(true);
      }
  });
});

describe("fill: short content does not float", () => {
  test("practice is top-aligned under the title; the exit ticket is centred in the stage", () => {
    for (const age of Object.keys(AGES) as Age[]) {
      const stage = AGES[age];
      const r = lay(
        { template: "practice", heading: "Sums", questions: ["1 + 2", "3 + 4"] },
        stage,
      );
      const head = named(r.slide.elements, "Heading")[0] as SlideElement;
      const first = named(r.slide.elements, WA_NAMES.rule)[0] as SlideElement;
      expect(first.y - (head.y + head.h)).toBeLessThanOrEqual(WA.practiceGap + 1);
      const e = lay(
        { template: "exit-ticket", heading: "Before you go", questions: ["Name one."] },
        stage,
      );
      const ticket = named(e.slide.elements, WA_NAMES.card)[0] as SlideElement;
      const top = (named(e.slide.elements, "Heading")[0] as SlideElement).y + 46 + WA.exitGap;
      const below = WA.foot - (ticket.y + ticket.h);
      expect(Math.abs(below - (ticket.y - top))).toBeLessThanOrEqual(12);
    }
  });

  test("at the measured caps the tasks fill most of the stage (60% or more)", () => {
    for (const [age, n] of [
      ["primary", 4],
      ["secondary", 3],
      ["early", 2],
    ] as [Age, number][]) {
      const cap = capOf(age, "practice", n);
      const r = lay(
        {
          template: "practice",
          heading: "The heart",
          questions: Array.from({ length: n }, () => workSample(cap?.cap ?? 0)),
        },
        AGES[age],
      );
      const els = r.slide.elements;
      const head = named(els, "Heading")[0] as SlideElement;
      const top = head.y + head.h + WA.practiceGap;
      const foot = Math.max(...named(els, WA_NAMES.task).map((e) => e.y + e.h));
      expect((foot - top) / (WA.foot - top)).toBeGreaterThanOrEqual(0.6);
    }
  });
});

describe("capacity: practice-capacity.json is what the renderer measures", () => {
  // A spot check (the full table: `bun packages/slides/src/templates/practice-capacity.ts`).
  const cells: [WorkVariant, Age, number][] = [
    ["practice", "primary", 4],
    ["practice+picture", "early", 3],
    ["exit", "secondary", 3],
  ];
  for (const [v, age, n] of cells)
    test(`${v} ${age} ${n}`, () => {
      expect(VARIANT_COUNTS[v]).toContain(n);
      expect(measureWorkCap(v, age, n)).toEqual(
        capOf(age, v, n) as NonNullable<ReturnType<typeof capOf>>,
      );
      const cap = capOf(age, v, n)?.hardMax ?? 0;
      expect(workFits(v, age, n, cap).fits).toBe(true);
    }, 60_000);

  test("each task carries its counter against the measured caps", () => {
    const r = lay(caseOf("practice-ks2-4-static").input, "ks2");
    expect(r.fields?.map((f) => f.path)).toEqual([
      "questions.0",
      "questions.1",
      "questions.2",
      "questions.3",
    ]);
    expect(r.fields?.every((f) => !f.over)).toBe(true);
  });
});

describe("answers stay with their tasks", () => {
  test("a blank task drops its own answer, on practice and the exit ticket", () => {
    const theme = getTheme("paper");
    for (const template of ["practice", "exit-ticket"] as const) {
      const r = layoutTemplate(
        {
          template,
          heading: "Halves",
          questions: ["Half of 8?", "  ", "Half of 20?"],
          answers: ["4", "x", "10"],
        },
        theme,
        "ks2",
      );
      expect(r.slide.question?.type === "open-response" && r.slide.question.modelAnswer).toBe(
        "1. 4\n2. 10",
      );
    }
  });
});
