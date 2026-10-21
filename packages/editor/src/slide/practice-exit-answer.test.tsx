import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  answersOffSlide,
  hasRevealableAnswer,
  type Lesson,
  type Slide,
  type SlideKind,
  slideStepCount,
} from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import JSZip from "jszip";
import { exportLessonPptx } from "../export/pptx";
import { docFromText } from "../model/factories";
import { getTheme } from "../model/themes";
import { SlideView } from "./SlideView";

/*
 * TEACH-230 part c: a practice slide and the exit ticket never draw their model answer on the
 * slide (practice-exit gold, "Reveal states: none"; ruling 231). The answer stays on the question,
 * because the end-of-deck Answers slides, the answer drawer and the PowerPoint key read it.
 */

afterEach(cleanup);

const theme = getTheme("splash");
const ANSWER = "1. The straight route shortens the journey in wet weather";

const slideOf = (kind: SlideKind): Slide => ({
  id: `s-${kind}`,
  kind,
  elements: [
    {
      id: "stem",
      type: "text",
      x: 60,
      y: 60,
      w: 840,
      h: 80,
      doc: docFromText("Explain why the Romans built straight roads."),
      style: { preset: "body" },
    } as never,
  ],
  question: { type: "open-response", modelAnswer: ANSWER },
});

const drawn = (slide: Slide, mode: "edit" | "present" | "capture" | "thumb") =>
  render(<SlideView slide={slide} theme={theme} mode={mode} revealAnswer />).container
    .textContent ?? "";

describe("practice and exit slides draw no model answer", () => {
  for (const kind of ["open-response", "exit-ticket"] as const) {
    test(`${kind}: no surface draws the strip, even asked to reveal`, () => {
      const slide = slideOf(kind);
      expect(answersOffSlide(slide)).toBe(true);
      // Editor canvas (edit), Present and View (present), print and PDF (capture), thumbnails.
      for (const mode of ["edit", "present", "capture", "thumb"] as const)
        expect(drawn(slide, mode)).not.toContain("wet weather");
      // Present and View add no reveal step, so nothing on the slide waits for a click.
      expect(hasRevealableAnswer(slide)).toBe(false);
      expect(slideStepCount(slide)).toBe(0);
      // The data stays: the Answers slides and the drawer read it.
      expect(slide.question).toEqual({ type: "open-response", modelAnswer: ANSWER });
    });

    test(`${kind}: PowerPoint draws it only on the answer key, never on the slide`, async () => {
      const lesson = {
        ...creditedLesson(),
        themeId: "splash",
        slides: [slideOf(kind)],
      } as never as Lesson;
      const zip = await JSZip.loadAsync(
        await (await exportLessonPptx(lesson, theme, { includeAnswers: true })).arrayBuffer(),
      );
      const first = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
      expect(first).toContain("straight roads");
      expect(first).not.toContain("wet weather");
    });
  }

  test("another open-response kind (a plenary question) still reveals its answer", () => {
    const slide = slideOf("plenary");
    expect(answersOffSlide(slide)).toBe(false);
    expect(hasRevealableAnswer(slide)).toBe(true);
    expect(drawn(slide, "present")).toContain("wet weather");
  });
});
