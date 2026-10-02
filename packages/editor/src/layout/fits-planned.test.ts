import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import {
  fitsPlanned,
  getTheme,
  materialiseSlide,
  measureHeadless,
  type SlideSpec,
  THEMES,
} from "@tj/slides";
import { slidesNeedingFit } from "./retheme";

/*
 * One ruler for generation and the editor: a slide `fitsPlanned` passes is one the editor's
 * first-open migration leaves alone. The migration flags a slide with `lintSlide` over
 * `renderedHeights` (`slidesNeedingFit`); both halves now live in `@tj/slides`, and this holds
 * them to the same answer with the headless ruler, on every theme, for every spec that passes.
 */

const META = { promptVersion: "test", model: "test", at: "2026-09-30T00:00:00.000Z" };

const SPECS: SlideSpec[] = [
  { kind: "content", factRefs: ["k1"], heading: "Roots", body: "Roots take in water." },
  {
    kind: "content",
    factRefs: ["k1"],
    heading: "What a leaf does",
    body: "A leaf uses sunlight to make food. It takes in carbon dioxide through tiny holes on its underside.",
  },
  {
    kind: "content",
    factRefs: ["k1"],
    heading: "A heading long enough to wrap onto a second line on most themes",
    body: Array.from({ length: 7 }, () => "Water moves up the stem to the leaves.").join(" "),
  },
  {
    kind: "true-false",
    factRefs: ["m1"],
    statement: "Plants get their food from the soil.",
    answer: false,
    explanation: "Plants make their own food in their leaves, using light.",
  },
  {
    kind: "starter",
    factRefs: ["q1"],
    heading: "Do now",
    items: ["Name two parts of a plant.", "What do roots do?"],
  },
  {
    kind: "exit-ticket",
    factRefs: ["q1"],
    heading: "Exit ticket",
    items: ["What do leaves make?", "Name one job of the stem."],
    footnote: "Answers: food; carries water",
  },
] as SlideSpec[];

describe("fitsPlanned agrees with the editor's lint", () => {
  test("no slide fitsPlanned passes is flagged by the first-open migration, on any theme", () => {
    let passed = 0;
    for (const spec of SPECS) {
      for (const theme of THEMES) {
        const one = fitsPlanned(spec, { stepDown: 1, themes: [theme] });
        if (!one.ok) continue;
        passed++;
        let n = 0;
        const slide = materialiseSlide(spec, theme.id, META, () => `e${++n}`);
        const lesson = { themeId: theme.id, slides: [slide] } as Lesson;
        const t = getTheme(theme.id);
        expect({
          spec: spec.kind,
          theme: theme.id,
          flagged: slidesNeedingFit(lesson, t, measureHeadless(t)),
        }).toEqual({
          spec: spec.kind,
          theme: theme.id,
          flagged: [],
        });
      }
    }
    // The check has teeth: most of these specs pass on most themes.
    expect(passed).toBeGreaterThan(SPECS.length * THEMES.length * 0.6);
  });

  test("a slide the migration would flag is one fitsPlanned refuses", () => {
    const spec = {
      kind: "content",
      factRefs: ["k1"],
      heading: "Too much",
      body: Array.from(
        { length: 12 },
        () => "Water moves up the stem to the leaves of the plant.",
      ).join(" "),
    } as SlideSpec;
    const theme = getTheme("chalk");
    let n = 0;
    const slide = materialiseSlide(spec, theme.id, META, () => `e${++n}`);
    const flagged = slidesNeedingFit(
      { themeId: theme.id, slides: [slide] } as Lesson,
      theme,
      measureHeadless(theme),
    );
    const planned = fitsPlanned(spec, { stepDown: 1, themes: [theme] });
    expect(flagged).toEqual([slide.id]);
    expect(planned.ok).toBe(false);
  });
});
