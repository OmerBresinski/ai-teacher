import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Lesson, SlideElement, TextElement } from "@tj/domain/documents";
import { docFromText } from "../../model/factories";
import { makeText } from "../../model/insert";
import { getTheme } from "../../model/themes";
import { EDIT_CHAT_LABEL } from "../edit-chat/edit-chat-context";
import { PANE_OPEN_KEY } from "../edit-chat/thread";
import type { PromptEditAnswer } from "../proposals-context";
import { catcher, pointer, renderEditor, seededLesson } from "../test-harness";
import { PROMPT_EDIT_LABEL } from "./PromptEditControl";

/*
 * The text toolbar's sparkle (TEACH-97): it opens the "Edit with Dayback" pane with the cursor in
 * the composer, and is absent when the app has not wired edits with a prompt.
 */

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function textLesson(): Lesson {
  const lesson = seededLesson();
  const first = lesson.slides[0];
  if (!first) throw new Error("seed");
  const box = { ...makeText("body", getTheme("chalk")), x: 500, y: 100, w: 300, h: 60 };
  (box as TextElement).doc = docFromText("Water warms up and turns into a gas.");
  first.elements = [box as SlideElement];
  return lesson;
}

const clickBox = (container: HTMLElement) => {
  fireEvent.pointerDown(catcher(container), pointer(550, 120));
  fireEvent.pointerUp(window, pointer(550, 120));
};

describe("the text toolbar's sparkle", () => {
  test("absent when the app has not wired it", () => {
    const { container } = renderEditor(textLesson());
    clickBox(container);
    const bar = screen.getByRole("toolbar", { name: "Text" });
    expect(within(bar).queryByRole("button", { name: PROMPT_EDIT_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(EDIT_CHAT_LABEL) })).toBeNull();
  });

  test("opens the pane with the composer focused, and the open state is remembered", () => {
    const onPromptEdit = mock(() => Promise.resolve({ action: "no-change", reason: "" }));
    const { container } = renderEditor(textLesson(), {
      onPromptEdit: onPromptEdit as unknown as () => Promise<PromptEditAnswer>,
    });
    clickBox(container);
    expect(screen.queryByRole("complementary", { name: EDIT_CHAT_LABEL })).toBeNull();
    const bar = screen.getByRole("toolbar", { name: "Text" });
    fireEvent.click(within(bar).getByRole("button", { name: PROMPT_EDIT_LABEL }));
    const pane = screen.getByRole("complementary", { name: EDIT_CHAT_LABEL });
    expect(document.activeElement).toBe(
      within(pane).getByRole("textbox", { name: "What to change" }),
    );
    expect(window.localStorage.getItem(PANE_OPEN_KEY)).toBe("1");
  });
});
