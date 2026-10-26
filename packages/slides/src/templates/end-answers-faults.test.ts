/**
 * TEACH-247 part ai: the Answers slides' own layout check (`answersFaults`). The deck's checks never
 * looked at these slides and `lintSlide` reads their designed layering as overlaps, so a "?" disc
 * left over an answer and an answer past the slide's foot shipped unseen (Great Fire Y2 s15/s16).
 * Every theme and key stage the template draws in must come out clean on these rules, measured as
 * the renderer draws the text.
 */
import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { answersFaults } from "../lint";
import { measureHeadless } from "../text-measure";
import { atKeyStage, THEMES } from "../themes";
import { ANSWERS_NAMES, type AnswerGroup, answerItem, endAnswerSlides } from "./end-answers";
import CASES from "./fixtures/end-answers-cases.json";
import type { Stage } from "./index";

/** The Great Fire of London Y2 answers (run 20261026-043258, verify2), as the deck collects them. */
const GREAT_FIRE: AnswerGroup[] = [
  {
    kind: "practice",
    title: "Use what you know",
    items: [
      answerItem(1, "Pudding Lane"),
      answerItem(2, "Strong winds could carry burning pieces to another wooden house."),
    ],
  },
  {
    kind: "practice",
    title: "Think like a builder",
    items: [
      answerItem(
        1,
        "I would use brick or stone walls because these materials do not burn like wood.",
      ),
      answerItem(
        2,
        "Yes. Wood burns, so flames could still spread from house to house in the wind.",
      ),
    ],
  },
  {
    kind: "exit",
    title: "Show what you know",
    items: [
      answerItem(1, "Pudding Lane, 1666."),
      answerItem(
        2,
        "Wind carried burning wood to other houses, so houses were rebuilt using brick and stone, which do not burn.",
      ),
    ],
  },
] as AnswerGroup[];

const decks: [string, AnswerGroup[]][] = [
  ["great fire", GREAT_FIRE],
  ["ks1 case", (CASES as unknown as Record<string, { groups: AnswerGroup[] }>).ks1?.groups ?? []],
  ["ks2 case", (CASES as unknown as Record<string, { groups: AnswerGroup[] }>).ks2?.groups ?? []],
];

describe("Answers slides lay out clean in every theme, KS1 and KS2 (TEACH-247 part ai)", () => {
  for (const stage of ["ks1", "ks2"] as Stage[])
    for (const base of THEMES)
      for (const [name, groups] of decks)
        test(`${base.id} ${stage}: ${name}`, () => {
          const theme = atKeyStage(base, stage);
          const slides = endAnswerSlides(groups, theme, stage);
          expect(slides.length).toBeGreaterThan(1);
          const ruler = measureHeadless(theme);
          for (const s of slides) expect(answersFaults(s, ruler)).toEqual([]);
        });
});

describe("answersFaults sees what lintSlide cannot", () => {
  const theme = atKeyStage(THEMES[0] as (typeof THEMES)[number], "ks1");
  const page = () => endAnswerSlides(GREAT_FIRE, theme, "ks1")[1] as Slide;

  test("it reads the template's own names", () => {
    expect(ANSWERS_NAMES.hidden).toBe("Hidden answer");
    expect(ANSWERS_NAMES.cover).toBe("Revealed");
  });

  test("a disc left behind its moved cover and answer is an overlap", () => {
    const s = page();
    const cover = s.elements.findIndex((e) => e.name === ANSWERS_NAMES.cover);
    const moved = s.elements.map((e, i) =>
      i === cover || i === cover + 1 ? { ...e, y: e.y + 60 } : e,
    );
    const faults = answersFaults({ ...s, elements: moved });
    expect(faults.some((f) => f.includes("is not under its cover"))).toBe(true);
    expect(faults.every((f) => f.startsWith("overlap:"))).toBe(true);
  });

  test("an answer past the slide's foot is clipped", () => {
    const s = page();
    const last = s.elements.length - 1;
    const pushed = s.elements.map((e, i) => (i === last ? { ...e, y: 520 } : e));
    expect(answersFaults({ ...s, elements: pushed }).some((f) => f.startsWith("clipped:"))).toBe(
      true,
    );
  });

  test("a slide that is not the deck's Answers slide has none", () => {
    const s = page();
    expect(answersFaults({ ...s, answersRole: undefined })).toEqual([]);
  });
});
