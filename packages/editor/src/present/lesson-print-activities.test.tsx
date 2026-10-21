import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { lesson as baseLesson } from "@tj/domain/documents/fixtures";
import { LessonPrint } from "./LessonPrint";
import fixture from "./lesson-print-activities.fixture.json" with { type: "json" };

/* TEACH-101 part e: the writer now emits activity slides by default, so print must show their
 * question state, and their answers only when the teacher asks for them. */

afterEach(cleanup);

const activityLesson = () => ({ ...baseLesson(), slides: fixture.slides }) as unknown as Lesson;
const main = () => screen.getByRole("main");
const answerMarks = () => main().querySelectorAll("[data-answer-anim], [data-choice-mark]");

describe("LessonPrint activity slides", () => {
  it("prints each activity slide on its own page with its question showing", () => {
    render(<LessonPrint lesson={activityLesson()} />);
    expect(main().dataset.pageCount).toBe(String(fixture.slides.length));
    expect(screen.getByText("Which baby grows into a hen?")).toBeTruthy();
    expect(screen.getByText("Match each baby to its name")).toBeTruthy();
  });

  it("gives no answer away unless answers are asked for", () => {
    const { unmount } = render(<LessonPrint lesson={activityLesson()} />);
    expect(answerMarks().length).toBe(0);
    unmount();
    render(<LessonPrint lesson={activityLesson()} options={{ answers: true }} />);
    expect(answerMarks().length).toBeGreaterThan(0);
  });
});
