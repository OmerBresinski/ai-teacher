import { describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Lesson, Slide } from "@tj/domain/documents";
import * as kit from "@tj/slides/relayout";
import { newLesson } from "../model/factories";
import { renderTheme } from "../model/themes";
import { openLessonActions, pointer, renderEditor } from "./test-harness";

/*
 * TEACH-191 part e (ruling 260; Q10 B): "Hide answers" on a guard or Answers slide's toolbar
 * removes them all in one undo step; the rail's slide menu "Show answers slides" adds them back.
 */

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function answeredLesson(): Lesson {
  const lesson = newLesson("Water cycle");
  lesson.ageBand = "ks2";
  const question = {
    id: "q1",
    kind: "open-response",
    elements: [
      {
        id: "h1",
        type: "text",
        name: "Heading",
        x: 64,
        y: 46,
        w: 832,
        h: 54,
        style: { preset: "heading" },
        doc: doc("Practice"),
      },
    ],
    question: { type: "open-response", modelAnswer: "1. Evaporation\n2. Condensation" },
  } as unknown as Slide;
  const theme = renderTheme(lesson);
  const slides = [...lesson.slides, question];
  return {
    ...lesson,
    slides: [...slides, ...kit.buildEndAnswers(slides, theme, kit.stageOf(theme, "ks2"))],
  };
}

const roles = (l: Lesson) => l.slides.filter((s) => s.answersRole).map((s) => s.answersRole);
const rows = () => within(screen.getByRole("listbox", { name: "Slides" })).getAllByRole("option");
function selectRow(i: number) {
  const row = rows()[i];
  if (!row) throw new Error("row");
  fireEvent.pointerDown(row, pointer(20, 20));
  fireEvent.pointerUp(row, pointer(20, 20));
}
const slideToolbar = () => screen.getByRole("toolbar", { name: "Slide" });
async function showFromRail() {
  fireEvent.contextMenu(rows()[0] as HTMLElement, { clientX: 40, clientY: 120 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Show answers slides" }));
}

describe("Hide answers / Show answers slides", () => {
  test("Hide answers on an Answers slide removes them; one undo brings them back", async () => {
    const { read } = renderEditor(answeredLesson());
    expect(roles(read())).toEqual(["guard", "answers"]);
    selectRow(read().slides.length - 1);
    fireEvent.click(within(slideToolbar()).getByRole("button", { name: "Hide answers" }));
    await waitFor(() => expect(roles(read())).toEqual([]));
    expect(read().answersOff).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(roles(read())).toEqual(["guard", "answers"]);
    expect(read().answersOff).toBeUndefined();
  });

  test("the guard has the control too; the rail's slide menu shows them again at the end", async () => {
    const { read } = renderEditor(answeredLesson());
    selectRow(read().slides.findIndex((s) => s.answersRole === "guard"));
    fireEvent.click(within(slideToolbar()).getByRole("button", { name: "Hide answers" }));
    await waitFor(() => expect(roles(read())).toEqual([]));
    await showFromRail();
    await waitFor(() => expect(roles(read())).toEqual(["guard", "answers"]));
    expect(read().slides.at(-1)?.answersRole).toBe("answers");
  });

  test("other slides have no Hide answers, and the rail offers Show only while hidden", async () => {
    renderEditor(answeredLesson());
    selectRow(0);
    expect(within(slideToolbar()).queryByRole("button", { name: "Hide answers" })).toBeNull();
    fireEvent.contextMenu(rows()[0] as HTMLElement, { clientX: 40, clientY: 120 });
    await screen.findByRole("menuitem", { name: /Duplicate/ });
    expect(screen.queryByRole("menuitem", { name: "Show answers slides" })).toBeNull();
  });

  test("the lesson's ⋯ menu has no Answers entry", () => {
    renderEditor(answeredLesson());
    openLessonActions();
    expect(within(screen.getByLabelText("Lesson actions")).queryByText(/Answers/)).toBeNull();
  });
});
