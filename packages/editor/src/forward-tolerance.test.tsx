import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { parseLesson, parseWorksheet } from "@tj/domain/documents";
import { getTheme } from "@tj/slides/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideView } from "./slide/SlideView";
import { WorksheetPrint } from "./worksheet/WorksheetPrint";

/*
 * Rollback tolerance (release 11 Nov): a lesson and the sheets the next release saved, read by
 * this build, draw without throwing: every slide in the editor's view and each sheet's print
 * view, including a sheet the newer build saved as failed (`stage: "failed"`, a recipe id this
 * build does not offer). The keys the newer build added change nothing this build draws.
 */

const dir = join(import.meta.dir, "../../domain/src/documents/fixtures/forward-11nov");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

afterEach(() => cleanup());

describe("documents the next release saved draw under this build", () => {
  test("every slide of the lesson", () => {
    const lesson = parseLesson(fixture("lesson-y8-photosynthesis"));
    const theme = getTheme(lesson.themeId, lesson.ageBand);
    expect(lesson.slides.length).toBeGreaterThan(0);
    for (const slide of lesson.slides) {
      const html = renderToStaticMarkup(<SlideView slide={slide} theme={theme} mode="capture" />);
      expect(html.length).toBeGreaterThan(0);
    }
  });

  for (const name of ["practice-y5-fractions", "exit-y5-fractions", "failed-y5-fractions"]) {
    test(`the print view of ${name}`, async () => {
      const worksheet = parseWorksheet(fixture(name));
      const { container } = render(<WorksheetPrint worksheet={worksheet} />);
      await settle();
      expect(container.querySelectorAll(".ws-print-root .ws-page").length).toBeGreaterThan(0);
    });
  }
});
