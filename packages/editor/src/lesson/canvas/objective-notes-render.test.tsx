import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { listLesson } from "../../model/reducers/objective-lines.test-helpers";
import { getTheme } from "../../model/themes";
import { SlideStatic } from "../../slide/SlideStatic";
import { renderEditor } from "../test-harness";

/* Ruling 96: the line note is in the editor's canvas and nowhere else. */

const untaughtO2 = (): Lesson => {
  const lesson = listLesson();
  lesson.slides = lesson.slides.filter((s) => s.id !== "s-teach-2");
  return lesson;
};

describe("ObjectiveNotes", () => {
  test("the objectives slide shows the note on the untaught line; Ignore takes it away", async () => {
    const { container, read } = renderEditor(untaughtO2(), { initialSlideId: "s-objectives" });
    const note = container.querySelector<HTMLElement>("[data-objective-note='not-taught']");
    if (!note) throw new Error("no note on the untaught line");
    expect(note.textContent).toContain("No slide teaches this yet");
    expect(container.querySelectorAll("[data-underline='not-taught']").length).toBeGreaterThan(0);
    const ignore = Array.from(note.querySelectorAll("button")).find(
      (b) => b.textContent === "Ignore",
    );
    if (!ignore) throw new Error("no Ignore");
    fireEvent.click(ignore);
    expect(read().ignoredChecks).toEqual([{ check: "objective-taught", factId: "o2" }]);
    // The findings follow the autosave cadence (`useComputedResidualFindings`).
    await waitFor(
      () => expect(container.querySelectorAll("[data-objective-note]").length).toBe(0),
      {
        timeout: 3000,
      },
    );
  });

  test("the navigator puts the dot on the objectives slide", () => {
    renderEditor(untaughtO2(), { initialSlideId: "s-objectives" });
    const rows = within(screen.getByRole("listbox", { name: "Slides" })).getAllByRole("option");
    expect(rows[1]?.querySelectorAll("[data-residual-badge]").length).toBe(1);
  });

  test("a thumbnail of the same slide carries no note or underline", () => {
    const slide = untaughtO2().slides.find((s) => s.id === "s-objectives");
    if (!slide) throw new Error("fixture");
    const { container } = render(
      <SlideStatic slide={slide} theme={getTheme("chalk")} width={168} />,
    );
    expect(container.querySelectorAll("[data-objective-note], [data-underline]").length).toBe(0);
  });
});
