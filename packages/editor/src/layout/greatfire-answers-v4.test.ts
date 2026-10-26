/**
 * TEACH-247 part am (Great Fire of London, Year 2, Crayon Box; run 20261026-074746 verify4). The
 * job laid the Answers slides in Splash; the teacher had picked Crayon Box. Part ai re-laid them
 * only on the round the job first sent them (with a ruler), but the merge hands back the job's copy
 * every round and the next round only recoloured it, so Splash's rows were drawn in Crayon's wider
 * face: answer 1 wrapped to a third line, "easily.", over answer 2. `answersFaults` missed it: it
 * ran in the job's theme, and it only checked discs and the foot, never words on words.
 * The fixture is the lesson as it was saved.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { answersFaults, measureHeadless } from "@tj/slides";
import * as kit from "@tj/slides/relayout";
import { THEMES } from "@tj/slides/themes";
import { seededLesson } from "../lesson/test-harness";
import { setLayoutKit } from "../model/layout-kit";
import { renderTheme } from "../model/themes";
import fx from "./fixtures/greatfire-y2-crayon-v4.json";
import { inLessonTheme } from "./retheme";

const saved = fx.slides as unknown as Slide[];
const lessonIn = (themeId: string, ageBand: string, slides: Slide[] = saved): Lesson =>
  ({
    ...seededLesson(),
    themeId,
    ageBand,
    yearGroup: ageBand === "ks1" ? "Year 2" : "Year 5",
    generation: fx.generation,
    slides,
  }) as unknown as Lesson;

/** The job's copy: the lesson slides, then the guard and Answers built in `themeId`. */
const jobDeck = (themeId: string, ageBand: string): Slide[] => {
  const t = renderTheme(lessonIn(themeId, ageBand));
  const lesson = saved.filter((s) => !s.answersRole);
  const ends = kit.withIds(
    kit.buildEndAnswers(lesson, t, kit.stageOf(t, ageBand)),
    saved.filter((s) => s.answersRole),
  );
  return [...lesson, ...ends];
};

describe("Answers slides drawn in another theme are laid again every pass (TEACH-247 part am)", () => {
  beforeAll(() => setLayoutKit(kit));
  afterAll(() => setLayoutKit(null));

  test("the saved s15 in Crayon: answersFaults now names answer 1 running into answer 2", () => {
    const crayon = renderTheme(lessonIn("crayon", "ks1"));
    const s15 = saved.find((s) => s.answersRole === "answers") as Slide;
    const faults = answersFaults(s15, measureHeadless(crayon));
    expect(faults.some((f) => f.startsWith("overlap:") && f.includes("runs into"))).toBe(true);
  });

  test("a later round with no ruler, and a copy already in Crayon's palette, are re-laid too", () => {
    const lesson = lessonIn("crayon", "ks1", jobDeck("splash", "ks1"));
    const crayon = renderTheme(lesson);
    const ruler = measureHeadless(crayon);
    for (const s of lesson.slides.filter((x) => x.answersRole)) {
      const round2 = inLessonTheme(s, lesson);
      // Crayon needs four pages for what Splash put on two, and a slide cannot add slides: the
      // rows stack in Crayon's faces (no words on words), the last may reach the foot.
      const words = (x: Slide) => answersFaults(x, ruler).filter((f) => !f.startsWith("clipped:"));
      expect(words(round2)).toEqual([]);
      expect(round2.elements.map((e) => e.id).sort()).toEqual(s.elements.map((e) => e.id).sort());
      // The saved shape: Splash rows already recoloured to Crayon (best === own).
      const savedLike = saved.find((x) => x.id === s.id) as Slide;
      expect(words(inLessonTheme(savedLike, lessonIn("crayon", "ks1")))).toEqual([]);
      // Laid once, a pass returns it as it is: no churn for the autosave.
      expect(inLessonTheme(round2, lesson)).toBe(round2);
    }
  });

  test("built in the row's theme, as the job now does (`themeNow`), every page is clean", () => {
    const deck = jobDeck("crayon", "ks1");
    const ruler = measureHeadless(renderTheme(lessonIn("crayon", "ks1")));
    const ends = deck.filter((x) => x.answersRole);
    expect(ends.length).toBe(5);
    for (const s of ends) expect(answersFaults(s, ruler)).toEqual([]);
  });

  test("a page whose words the teacher changed keeps its own rows", () => {
    const lesson = lessonIn("crayon", "ks1", jobDeck("splash", "ks1"));
    const page = lesson.slides.find((x) => x.answersRole === "answers") as Slide;
    const edited: Slide = {
      ...page,
      elements: page.elements.map((e) =>
        e.name === "Model answer"
          ? ({
              ...e,
              doc: {
                type: "doc",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Close houses burn." }] },
                ],
              },
            } as typeof e)
          : e,
      ),
    };
    const out = inLessonTheme(edited, {
      ...lesson,
      slides: lesson.slides.map((s) => (s.id === page.id ? edited : s)),
    });
    expect(out.elements.map((e) => [e.x, e.y, e.h])).toEqual(
      edited.elements.map((e) => [e.x, e.y, e.h]),
    );
  });

  // Every pair of themes at both stages. Where the new theme splits the answers over as many
  // pages, each page is the builder's own: nothing at fault. Where it needs more pages than the job
  // made, the stored split stays (a slide cannot add slides) and steps down as far as the stage's
  // type steps allow; words may then reach the foot, but never another answer or a stray disc.
  // The job builds the Answers slides in the row's theme now (`themeNow`), so that is the rare
  // pick between the job's last write and its end.
  for (const band of ["ks1", "ks2"])
    test(`laid in any theme, drawn in any other at ${band}`, () => {
      const bad: string[] = [];
      for (const from of THEMES)
        for (const to of THEMES) {
          if (from.id === to.id) continue;
          const deck = jobDeck(from.id, band);
          const lesson = lessonIn(to.id, band, deck);
          const t = renderTheme(lesson);
          const fresh = kit.buildEndAnswers(deck, t, kit.stageOf(t, band)).length;
          const same = fresh === deck.filter((x) => x.answersRole).length;
          const ruler = measureHeadless(t);
          for (const s of lesson.slides.filter((x) => x.answersRole)) {
            const f = answersFaults(inLessonTheme(s, lesson), ruler).filter(
              (x) => same || !x.startsWith("clipped:"),
            );
            if (f.length) bad.push(`${from.id}->${to.id} ${s.answersRole}: ${f[0]}`);
          }
        }
      expect(bad).toEqual([]);
    });
});
