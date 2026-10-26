/**
 * TEACH-247 part ai (Great Fire of London, Year 2, Crayon Box; run 20261026-043258 verify2). The
 * job laid the deck in the theme the lesson started in (Splash) and the teacher picked Crayon Box
 * while it wrote. Each arriving slide was fitted to Crayon by Tidy (part ag), which reflowed the
 * Answers slides' rows: each hidden "?" disc stayed where it was while its cover and answer moved,
 * so a disc sat over the answer above ("?.dding Lane") and the last answer ran off the slide.
 * The fixture is the lesson as it was saved. Guard and Answers slides are now laid again by their
 * template in the lesson's theme, and `answersFaults` names what the deck's checks used to miss.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { answersFaults, contains, measureHeadless, rectOf } from "@tj/slides";
import * as kit from "@tj/slides/relayout";
import { seededLesson } from "../lesson/test-harness";
import { setLayoutKit } from "../model/layout-kit";
import { renderTheme } from "../model/themes";
import fx from "./fixtures/greatfire-y2-crayon.json";
import { inLessonTheme } from "./retheme";

/** Crayon Box's paper (`tokens.json` crayon `bg`), the cover the saved slides wear. */
const CRAYON_PAPER = "#fffdf7";
const saved = fx.slides as unknown as Slide[];
const lessonIn = (themeId: string, slides: Slide[]): Lesson =>
  ({ ...seededLesson(), themeId, ageBand: "ks1", yearGroup: "Year 2", slides }) as Lesson;

/** The deck as the job laid it: the lesson slides, then the guard and Answers built in Splash. */
const jobDeck = (): Slide[] => {
  const splash = renderTheme(lessonIn("splash", saved));
  const lesson = saved.filter((s) => !s.answersRole);
  const ends = kit.withIds(kit.buildEndAnswers(lesson, splash, kit.stageOf(splash, "ks1")), saved);
  return [...lesson, ...ends];
};

describe("Answers slides arriving in the starting theme are laid by their template (TEACH-247 part ai)", () => {
  beforeAll(() => setLayoutKit(kit));
  afterAll(() => setLayoutKit(null));
  const crayon = renderTheme(lessonIn("crayon", saved));
  const ruler = measureHeadless(crayon);

  test("the saved s15 and s16 carry the faults the judge saw, and the check names them", () => {
    const [s15, s16] = saved.filter((s) => s.answersRole === "answers") as [Slide, Slide];
    const f15 = answersFaults(s15, ruler);
    expect(f15.some((f) => f.includes("not under its cover"))).toBe(true);
    expect(f15.some((f) => f.startsWith("clipped:"))).toBe(true);
    expect(answersFaults(s16, ruler).some((f) => f.includes("not under its cover"))).toBe(true);
  });

  test("fitted to Crayon: no disc off its cover or answer, nothing past the foot, ids kept", () => {
    const deck = jobDeck();
    const lesson = lessonIn("crayon", deck);
    const ends = deck.filter((s) => s.answersRole);
    expect(ends.length).toBe(3);
    for (const s of ends) {
      const out = inLessonTheme(s, lesson, ruler);
      expect(out.id).toBe(s.id);
      expect(out).not.toBe(s);
      expect(answersFaults(out, ruler)).toEqual([]);
      // Each disc under its cover; each cover the lesson's paper, not Splash's.
      const covers = out.elements.filter((e) => e.name === "Revealed");
      for (const d of out.elements.filter((e) => e.name === "Hidden answer"))
        expect(covers.some((c) => contains(rectOf(c), rectOf(d)))).toBe(true);
      for (const c of covers)
        expect((c as { fill?: string }).fill?.toLowerCase()).toBe(CRAYON_PAPER);
    }
  });

  test("without the template code loaded it is recoloured, never reflowed", () => {
    setLayoutKit(null);
    try {
      const deck = jobDeck();
      const s = deck.find((x) => x.answersRole === "answers") as Slide;
      const out = inLessonTheme(s, lessonIn("crayon", deck), ruler);
      expect(out.elements.map((e) => [e.x, e.y, e.h])).toEqual(
        s.elements.map((e) => [e.x, e.y, e.h]),
      );
    } finally {
      setLayoutKit(kit);
    }
  });
});
