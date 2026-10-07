import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Lesson, SlideElement, TextElement } from "@tj/domain/documents";
import { richDocToPlainText } from "@tj/domain/documents";
import { docFromText } from "../../model/factories";
import { makeText } from "../../model/insert";
import { getTheme } from "../../model/themes";
import type { PromptEditAnswer, PromptEditRequest } from "../proposals-context";
import { catcher, pointer, renderEditor, seededLesson } from "../test-harness";
import { PROMPT_EDIT_LABEL, SUGGESTIONS } from "./PromptEditControl";

/*
 * Edit with a prompt, fast path (TEACH-97 part d): the text toolbar's button, the four text
 * suggestions of ruling 175, the edit applied as one undo step (ruling 172) and a refusal shown in
 * the panel with nothing changed.
 */

afterEach(cleanup);

const theme = getTheme("chalk");

function textLesson(): Lesson {
  const lesson = seededLesson();
  const first = lesson.slides[0];
  if (!first) throw new Error("seed");
  const box = { ...makeText("body", theme), x: 500, y: 100, w: 300, h: 60 } as TextElement;
  box.doc = docFromText("Water warms up and turns into a gas called water vapour.");
  first.elements = [box as SlideElement];
  return lesson;
}

const clickAt = (container: HTMLElement, x: number, y: number) => {
  fireEvent.pointerDown(catcher(container), pointer(x, y));
  fireEvent.pointerUp(window, pointer(x, y));
};
const textOf = (lesson: Lesson) => {
  const box = lesson.slides[0]?.elements[0] as TextElement | undefined;
  return box ? richDocToPlainText(box.doc) : "";
};

function setup(answer: PromptEditAnswer) {
  const onPromptEdit = mock((_req: PromptEditRequest) => Promise.resolve(answer));
  const utils = renderEditor(textLesson(), { onPromptEdit });
  clickAt(utils.container, 550, 120);
  const bar = screen.getByRole("toolbar", { name: "Text" });
  return { ...utils, onPromptEdit, bar };
}

describe("Edit with a prompt", () => {
  test("no button when the app has not wired it", () => {
    const { container } = renderEditor(textLesson());
    clickAt(container, 550, 120);
    const bar = screen.getByRole("toolbar", { name: "Text" });
    expect(within(bar).queryByRole("button", { name: PROMPT_EDIT_LABEL })).toBeNull();
  });

  test("a suggestion sends the slide, the box and its instruction; the edit is one undo step", async () => {
    const { bar, onPromptEdit, read } = setup({
      action: "edit",
      doc: docFromText("Water heats up and becomes a gas."),
      summary: "Made it shorter.",
    });
    fireEvent.click(within(bar).getByRole("button", { name: PROMPT_EDIT_LABEL }));
    const panel = await screen.findByRole("dialog", { name: PROMPT_EDIT_LABEL });
    for (const s of SUGGESTIONS)
      expect(within(panel).getByRole("button", { name: s.label })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Shorter" }));
    });
    await waitFor(() => expect(textOf(read())).toBe("Water heats up and becomes a gas."));
    const req = onPromptEdit.mock.calls[0]?.[0] as PromptEditRequest;
    expect(req.instruction).toBe("Make it shorter");
    expect(req.elementId).toBe(read().slides[0]?.elements[0]?.id as string);
    expect(req.slide.id).toBe(read().slides[0]?.id as string);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(textOf(read())).toBe("Water warms up and turns into a gas called water vapour.");
  });

  test("a typed instruction is sent as typed", async () => {
    const { bar, onPromptEdit } = setup({ action: "no-change", reason: "No change." });
    fireEvent.click(within(bar).getByRole("button", { name: PROMPT_EDIT_LABEL }));
    const panel = await screen.findByRole("dialog", { name: PROMPT_EDIT_LABEL });
    fireEvent.change(within(panel).getByRole("textbox", { name: "What to change" }), {
      target: { value: "Use the word condensation" },
    });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    });
    expect(onPromptEdit.mock.calls[0]?.[0].instruction).toBe("Use the word condensation");
  });

  test("a refusal shows its reason in the panel and changes nothing", async () => {
    const reason = "That won’t fit on this slide. Try a shorter change.";
    const { bar, read } = setup({ action: "refuse", reason });
    const before = textOf(read());
    fireEvent.click(within(bar).getByRole("button", { name: PROMPT_EDIT_LABEL }));
    const panel = await screen.findByRole("dialog", { name: PROMPT_EDIT_LABEL });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Harder" }));
    });
    expect(await within(panel).findByRole("alert")).toHaveTextContent(reason);
    expect(textOf(read())).toBe(before);
  });
});
