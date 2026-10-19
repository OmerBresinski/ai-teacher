import { describe, expect, test } from "bun:test";
import {
  type Lesson,
  richDocToPlainText,
  type Slide,
  type TextElement,
  type Theme,
} from "@tj/domain/documents";
import { countLines, measureHeadless, resolveFontSize } from "@tj/slides";
import { answerGroupsOf, endAnswerSlides } from "@tj/slides/templates/end-answers";
import { layoutKit, loadLayoutKit } from "../model/layout-kit";
import { renderTheme } from "../model/themes";
import LIVE from "./fixtures/end-answers-live.json" with { type: "json" };
import { rethemeLesson } from "./retheme";

/*
 * TEACH-191 part d: the live lessons whose end Answers slides drew one answer's second line over
 * the next (runs 20261016-1221 y4-romans, y2-plants, a-hinge-y9-forces; 20261016-1145 y4-romans).
 * Writer lessons render at their key stage, where a body box's size snaps to the stage's steps (KS2
 * 29 or 25), so rows measured at 22 drew at 25. Replayed in the lesson's own theme and after a
 * switch to Paper through rethemeLesson: every answer box holds its wrapped words at the size it is
 * drawn at, no two boxes cross, and the answers split only when they do not fit.
 */
type Saved = {
  themeId: string;
  ageBand: string;
  yearGroup: string;
  generation: unknown;
  slides: Slide[];
};
// Every slide gets `notes: ""` as a loaded lesson's slides do, so the replay matches the app.
const lessonOf = (s: Saved, slides = s.slides) =>
  ({
    id: "l",
    title: "Live",
    ...s,
    slides: slides.map((x) => ({ notes: "", ...x })),
  }) as unknown as Lesson;

/** Every way two of a slide's words cross, each box measured at its drawn size in `theme`. */
function overlaps(slide: Slide, theme: Theme): string[] {
  const boxes = (slide.elements.filter((e) => e.type === "text") as TextElement[])
    .filter((e) => e.name !== "Heading")
    .map((e) => {
      const words = richDocToPlainText(e.doc);
      // Measured as drawn: the kicker is a caption (caps, tracked), the rest body.
      const preset = e.style?.preset ?? "body";
      const size = resolveFontSize(theme, preset, e.style?.fontSize);
      const lines = countLines(words, preset, theme, e.w, e.style?.fontWeight, size);
      return {
        words,
        x: e.x,
        w: e.w,
        y: e.y,
        bottom: e.y + lines * size * (e.style?.lineHeight ?? 1.3),
      };
    });
  const out: string[] = [];
  for (const a of boxes)
    for (const b of boxes) {
      if (a === b || a.y > b.y) continue;
      const side = a.x + a.w <= b.x || b.x + b.w <= a.x;
      if (!side && a.bottom > b.y + 0.5 && a.y !== b.y)
        out.push(
          `"${a.words.slice(0, 30)}" ends at ${Math.round(a.bottom)} under "${b.words.slice(0, 30)}" at ${b.y}`,
        );
    }
  return out;
}

const answersOf = (slides: readonly Slide[]) => slides.filter((s) => s.answersRole === "answers");
await loadLayoutKit();
const PAGES = { own: {} as Record<string, number>, paper: {} as Record<string, number> };

describe("live end Answers slides: wrapped rows never overlap", () => {
  for (const [name, saved] of Object.entries(LIVE as unknown as Record<string, Saved>)) {
    const lesson = lessonOf(saved);
    const stage = saved.ageBand as "ks2" | "ks3";

    test(`${name} in its own theme (${saved.themeId})`, () => {
      const theme = renderTheme(lesson);
      const pages = answersOf(endAnswerSlides(answerGroupsOf(saved.slides), theme, stage));
      for (const p of pages) expect(overlaps(p, theme)).toEqual([]);
      PAGES.own[name] = pages.length;
      expect(pages.length).toBeLessThanOrEqual(3);
    });

    test(`${name} switched to paper through rethemeLesson`, () => {
      const to = renderTheme(lesson, "paper");
      const { lesson: out } = rethemeLesson(lesson, "paper", measureHeadless(to), layoutKit());
      const pages = answersOf(out.slides);
      // The saved slides were built at the old sizes: the switch rebuilds them, it never keeps them.
      expect(pages.some((p) => saved.slides.includes(p))).toBe(false);
      for (const p of pages) expect(overlaps(p, to)).toEqual([]);
      PAGES.paper[name] = pages.length;
      expect(pages.length).toBeLessThanOrEqual(3);
    });
  }
  const docOf = (text: string) =>
    ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }) as never;
  /** Each way a teacher can touch an old-size Answers slide: every one keeps all of them. */
  const EDITS: [string, (e: Slide["elements"][number]) => Slide["elements"][number]][] = [
    [
      "an answer's words",
      (e) => (e.name === "Model answer" ? { ...e, doc: docOf("Firm roads.") } : e),
    ],
    [
      "the heading",
      (e) => (e.name === "Heading" ? { ...e, doc: docOf("Answers for Thursday") } : e),
    ],
    ["a kicker", (e) => (e.name === "Kicker" ? { ...e, doc: docOf("HOMEWORK") } : e)],
    ["a source title", (e) => (e.name === "Source title" ? { ...e, doc: docOf("Roads") } : e)],
    [
      "the teacher pill",
      (e) =>
        e.type === "text" && e.name === "answers:teacher-only" ? { ...e, doc: docOf("Mine") } : e,
    ],
    ["a reveal step", (e) => (e.revealStep === 2 ? { ...e, revealStep: 1 } : e)],
  ];
  for (const [what, edit] of EDITS)
    test(`an edit to ${what} on an old-size Answers slide survives a switch`, () => {
      const saved = (LIVE as unknown as Record<string, Saved>)["20261016-1221/y4-romans"] as Saved;
      const i = saved.slides.findIndex((s) => s.answersRole === "answers");
      const edited = saved.slides.map((s, k) =>
        k === i ? { ...s, elements: s.elements.map(edit) } : s,
      );
      expect(JSON.stringify(edited)).not.toBe(JSON.stringify(saved.slides));
      const lesson = lessonOf(saved, edited);
      const { lesson: out } = rethemeLesson(
        lesson,
        "paper",
        measureHeadless(renderTheme(lesson, "paper")),
        layoutKit(),
      );
      const kept = (ss: readonly Slide[]) =>
        // Ids, places, sizes, words and steps as they were; only the theme's colours follow.
        JSON.stringify(
          ss.filter((s) => s.answersRole),
          (k, v) => (k === "color" || k === "fill" ? undefined : v),
        );
      expect(kept(out.slides)).toBe(kept(lesson.slides));
    });

  test("page counts", () => console.log(JSON.stringify(PAGES)));
});
