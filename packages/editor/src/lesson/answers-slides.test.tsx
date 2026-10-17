import { describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Lesson, Slide } from "@tj/domain/documents";
import * as kit from "@tj/slides/relayout";
import { newLesson } from "../model/factories";
import { renderTheme } from "../model/themes";

// The notice is read from sonner's call, as the other editor tests do (the queue is process-wide).
const toastSpy = mock((..._args: unknown[]) => "t");
const actualUi = await import("@tj/ui");
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

import { ANSWERS_HIDDEN_NOTICE, SHOW_ANSWERS_LABEL } from "./answers-slides";
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

  test("Delete on the rail (key or menu) hides them as Hide answers does; Show brings them back", async () => {
    const { read } = renderEditor(answeredLesson());
    const ids = read()
      .slides.filter((s) => s.answersRole)
      .map((s) => s.id);
    selectRow(read().slides.length - 1);
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Slides" }), { key: "Delete" });
    await waitFor(() => expect(roles(read())).toEqual([]));
    expect(read().answersOff?.kept.map((s) => s.id)).toEqual(ids);
    await showFromRail();
    await waitFor(() => expect(roles(read())).toEqual(["guard", "answers"]));
    expect(
      read()
        .slides.filter((s) => s.answersRole)
        .map((s) => s.id),
    ).toEqual(ids);

    // The rail menu's Delete on the guard, together with a plain slide: one undo step.
    const before = read().slides.length;
    const guard = read().slides.findIndex((s) => s.answersRole === "guard");
    selectRow(guard);
    fireEvent.contextMenu(rows()[guard] as HTMLElement, { clientX: 40, clientY: 120 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(roles(read())).toEqual([]));
    expect(read().answersOff).toBeDefined();
    expect(read().slides).toHaveLength(before - 2);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(roles(read())).toEqual(["guard", "answers"]);
  });

  test("the hidden notice's Show button brings them back", async () => {
    toastSpy.mockClear();
    const { read } = renderEditor(answeredLesson());
    selectRow(read().slides.length - 1);
    fireEvent.click(within(slideToolbar()).getByRole("button", { name: "Hide answers" }));
    await waitFor(() => expect(roles(read())).toEqual([]));
    const [message, options] = toastSpy.mock.calls.at(-1) ?? [];
    expect(message).toBe(ANSWERS_HIDDEN_NOTICE);
    const action = (options as { action?: { label: string; onClick: () => void } }).action;
    expect(action?.label).toBe("Show");
    action?.onClick();
    await waitFor(() => expect(roles(read())).toEqual(["guard", "answers"]));
    expect(read().answersOff).toBeUndefined();
  });

  test("Add slide offers Show answers slides only while they are hidden", async () => {
    const { read } = renderEditor(answeredLesson());
    const openAdd = () => fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
    const footer = () => screen.queryByRole("button", { name: SHOW_ANSWERS_LABEL });
    openAdd();
    await screen.findByRole("menu", { name: "Slide kinds" });
    expect(footer()).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Slide kinds" })).toBeNull());

    selectRow(read().slides.length - 1);
    fireEvent.click(within(slideToolbar()).getByRole("button", { name: "Hide answers" }));
    await waitFor(() => expect(roles(read())).toEqual([]));
    openAdd();
    fireEvent.click(await screen.findByRole("button", { name: SHOW_ANSWERS_LABEL }));
    await waitFor(() => expect(roles(read())).toEqual(["guard", "answers"]));
    await waitFor(() => expect(footer()).toBeNull());
  });
});
