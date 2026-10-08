import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Lesson, SlideElement, TextElement } from "@tj/domain/documents";
import { richDocToPlainText } from "@tj/domain/documents";
import { docFromText } from "../../model/factories";
import { makeText } from "../../model/insert";
import { getTheme } from "../../model/themes";
import type { PromptEditAnswer, PromptEditRequest } from "../proposals-context";
import { catcher, pointer, renderEditor, seededLesson } from "../test-harness";
import { EDIT_CHAT_LABEL } from "./edit-chat-context";
import {
  canUndo,
  PANE_OPEN_KEY,
  readThread,
  resolveFollowUp,
  scopeLabel,
  suggestionsFor,
  type Turn,
  threadKey,
} from "./thread";

/*
 * "Edit with Dayback" (TEACH-97): the docked pane, its chip that follows the selection, the
 * thread kept per lesson, Undo of exactly one change, refusals with a one-tap alternative, and the
 * follow-ups resolved in code.
 */

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const ORIGINAL = "Water warms up and turns into a gas called water vapour.";

function textLesson(): Lesson {
  const lesson = seededLesson();
  const theme = getTheme("chalk");
  lesson.slides.forEach((slide, i) => {
    const box = { ...makeText("body", theme), x: 500, y: 100, w: 300, h: 60 } as TextElement;
    box.doc = docFromText(i === 0 ? ORIGINAL : `Slide ${i + 1} text.`);
    slide.elements = [box as SlideElement];
  });
  return lesson;
}

const textOf = (lesson: Lesson, slide = 0) => {
  const box = lesson.slides[slide]?.elements[0] as TextElement | undefined;
  return box ? richDocToPlainText(box.doc) : "";
};

type Answer = (req: PromptEditRequest, signal?: AbortSignal) => Promise<PromptEditAnswer>;

function setup(answer: Answer, lesson = textLesson()) {
  window.localStorage.setItem(PANE_OPEN_KEY, "1");
  const onPromptEdit = mock(answer);
  const utils = renderEditor(lesson, { onPromptEdit });
  const pane = () => screen.getByRole("complementary", { name: EDIT_CHAT_LABEL });
  const chip = () => pane().querySelector("[data-edit-chat-scope]")?.textContent ?? "";
  const clickBox = () => {
    fireEvent.pointerDown(catcher(utils.container), pointer(550, 120));
    fireEvent.pointerUp(window, pointer(550, 120));
  };
  const say = async (text: string) => {
    fireEvent.change(within(pane()).getByRole("textbox", { name: "What to change" }), {
      target: { value: text },
    });
    await act(async () => {
      fireEvent.click(within(pane()).getByRole("button", { name: "Send" }));
    });
  };
  return { ...utils, onPromptEdit, pane, chip, clickBox, say, lesson };
}

const edit = (req: PromptEditRequest, text: string, summary: string): PromptEditAnswer => ({
  action: "edit",
  changes: [{ elementId: req.slide.elements[0]?.id as string, doc: docFromText(text) }],
  summary,
});

describe("Edit with Dayback pane", () => {
  test("the top bar button opens and closes it; the state is remembered", () => {
    const { pane } = setup(() => Promise.resolve({ action: "no-change", reason: "No change." }));
    expect(pane()).toBeTruthy();
    const toggle = screen.getByRole("button", { name: EDIT_CHAT_LABEL });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("complementary", { name: EDIT_CHAT_LABEL })).toBeNull();
    expect(window.localStorage.getItem(PANE_OPEN_KEY)).toBe("0");
  });

  test("the chip follows the selection, and removing it widens to the whole lesson", () => {
    const { chip, clickBox, pane } = setup(() =>
      Promise.resolve({ action: "no-change", reason: "" }),
    );
    expect(chip()).toBe("Slide 1");
    clickBox();
    expect(chip()).toBe("Slide 1 · text box");
    expect(within(pane()).getByRole("button", { name: "Shorter" })).toBeTruthy();
    fireEvent.click(within(pane()).getByRole("button", { name: /Remove Slide 1/ }));
    expect(chip()).toBe("Whole lesson");
    expect(within(pane()).queryByRole("button", { name: "Shorter" })).toBeNull();
  });

  test("a suggestion edits the selected box at once; Undo reverts exactly that change", async () => {
    const { clickBox, pane, onPromptEdit, read } = setup((req) =>
      Promise.resolve(edit(req, "Water heats up and becomes a gas.", "Made it shorter.")),
    );
    clickBox();
    await act(async () => {
      fireEvent.click(within(pane()).getByRole("button", { name: "Shorter" }));
    });
    await waitFor(() => expect(textOf(read())).toBe("Water heats up and becomes a gas."));
    const req = onPromptEdit.mock.calls[0]?.[0] as PromptEditRequest;
    expect(req.instruction).toBe("Make it shorter");
    expect(req.elementId).toBe(read().slides[0]?.elements[0]?.id as string);
    expect(within(pane()).getByText("Slide 1: Made it shorter.")).toBeTruthy();
    fireEvent.click(within(pane()).getByRole("button", { name: "Undo" }));
    expect(textOf(read())).toBe(ORIGINAL);
    expect(within(pane()).getByText("Undid: Shorter")).toBeTruthy();
    expect(within(pane()).getByRole("button", { name: "Undone" })).toBeTruthy();
  });

  test("nothing selected sends the slide; the thread is kept across a remount", async () => {
    const { say, onPromptEdit, unmount, lesson } = setup((req) =>
      Promise.resolve(edit(req, "Simpler words.", "Used simpler words.")),
    );
    await say("Use simpler words");
    await waitFor(() => expect(onPromptEdit).toHaveBeenCalledTimes(1));
    expect(onPromptEdit.mock.calls[0]?.[0].elementId).toBeUndefined();
    unmount();
    const saved = readThread(lesson.id);
    expect(saved.map((t) => t.reply.text)).toEqual(["Slide 1: Used simpler words."]);
    window.localStorage.setItem(PANE_OPEN_KEY, "1");
    renderEditor(lesson, { onPromptEdit });
    const pane = screen.getByRole("complementary", { name: EDIT_CHAT_LABEL });
    expect(within(pane).getByText("Slide 1: Used simpler words.")).toBeTruthy();
  });

  test("a refusal is said in the thread with its alternative, and changes nothing", async () => {
    const reason = "That won’t fit on this slide. Try a shorter change.";
    const { clickBox, say, pane, read, onPromptEdit } = setup(() =>
      Promise.resolve({ action: "refuse", reason, check: "fit" }),
    );
    clickBox();
    await say("Add four more sentences");
    expect((await within(pane()).findByRole("alert")).textContent).toBe(reason);
    expect(textOf(read())).toBe(ORIGINAL);
    await act(async () => {
      fireEvent.click(within(pane()).getByRole("button", { name: "Try a shorter version" }));
    });
    expect(onPromptEdit.mock.calls[1]?.[0].instruction).toBe(
      "Add four more sentences. Keep it short.",
    );
  });

  test("the model's one-tap offer under a refusal sends that instruction", async () => {
    const { clickBox, say, pane, onPromptEdit } = setup(() =>
      Promise.resolve({
        action: "refuse",
        reason: "That would give the answer away.",
        offer: "Add a hint instead",
        check: "model",
      }),
    );
    clickBox();
    await say("Put the answer in the question");
    const offer = within(pane()).getByRole("button", { name: "Add a hint instead" });
    // A long offer wraps inside the pane (no nowrap, no fixed height, capped at the pane width).
    expect(offer.className).toContain("whitespace-normal");
    expect(offer.className).toContain("max-w-full");
    expect(offer.className).toContain("h-auto");
    await act(async () => {
      fireEvent.click(offer);
    });
    expect(onPromptEdit.mock.calls[1]?.[0].instruction).toBe("Add a hint instead");
  });

  test("the whole lesson is answered in the pane, with this slide as the one-tap alternative", async () => {
    const { say, pane, onPromptEdit, chip } = setup((req) =>
      Promise.resolve(edit(req, "Easier.", "Made it easier.")),
    );
    fireEvent.click(within(pane()).getByRole("button", { name: /Remove Slide 1/ }));
    expect(chip()).toBe("Whole lesson");
    await say("Make it easier");
    expect(onPromptEdit).toHaveBeenCalledTimes(0);
    expect(within(pane()).getByRole("alert").textContent).toContain("whole lesson");
    await act(async () => {
      fireEvent.click(within(pane()).getByRole("button", { name: "Change slide 1 instead" }));
    });
    expect(onPromptEdit.mock.calls[0]?.[0].instruction).toBe("Make it easier");
  });

  test("Stop abandons the request and changes nothing", async () => {
    let seen: AbortSignal | undefined;
    const { say, pane, read } = setup(
      (_req, signal) =>
        new Promise((_resolve, reject) => {
          seen = signal;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await say("Make it harder");
    fireEvent.click(within(pane()).getByRole("button", { name: "Stop" }));
    expect(seen?.aborted).toBe(true);
    expect(within(pane()).getByText("Stopped. Nothing changed.")).toBeTruthy();
    expect(textOf(read())).toBe(ORIGINAL);
  });

  test("“do the same on the next slide” repeats the last change there; “undo that” reverts it", async () => {
    const { clickBox, pane, say, onPromptEdit, read } = setup((req) =>
      Promise.resolve(edit(req, `${req.instruction} done`, "Made it harder.")),
    );
    clickBox();
    await act(async () => {
      fireEvent.click(within(pane()).getByRole("button", { name: "Harder" }));
    });
    await say("do the same on the next slide");
    await waitFor(() => expect(onPromptEdit).toHaveBeenCalledTimes(2));
    const second = onPromptEdit.mock.calls[1]?.[0] as PromptEditRequest;
    expect(second.instruction).toBe("Make it harder");
    expect(second.history).toEqual([
      { instruction: "Make it harder", summary: "Slide 1: Made it harder.", slides: ["s1"] },
    ]);
    expect(second.slide.id).toBe(read().slides[1]?.id as string);
    await waitFor(() => expect(textOf(read(), 1)).toBe("Make it harder done"));
    await say("undo that");
    expect(textOf(read(), 1)).toBe("Slide 2 text.");
    expect(textOf(read(), 0)).toBe("Make it harder done");
  });
});

describe("thread helpers", () => {
  const lesson = textLesson();
  const s1 = lesson.slides[0]?.id as string;
  const s2 = lesson.slides[1]?.id as string;
  const box = lesson.slides[0]?.elements[0] as TextElement;

  test("scope labels", () => {
    expect(scopeLabel(lesson, {})).toBe("Whole lesson");
    expect(scopeLabel(lesson, { slideId: s2 })).toBe("Slide 2");
    expect(scopeLabel(lesson, { slideId: s1, elementId: box.id })).toBe("Slide 1 · text box");
    expect(scopeLabel(lesson, { slideId: s1 }, 3)).toBe("Slide 1 · 3 items");
  });

  test("only suggestions whose path works are offered (no picture or animate yet)", () => {
    expect(suggestionsFor(lesson, { slideId: s1 }).map((s) => s.label)).toEqual([
      "Easier",
      "Harder",
      "Shorter",
      "Turn into a question",
    ]);
    expect(suggestionsFor(lesson, {})).toEqual([]);
  });

  const applied: Turn = {
    id: "a",
    said: "Easier",
    instruction: "Make it easier",
    scope: { slideId: s1, elementId: box.id },
    scopeLabel: "Slide 1 · text box",
    reply: { kind: "edit", text: "Slide 1: Made it easier." },
    change: { slideId: s1, boxes: [{ elementId: box.id, before: box.doc, after: box.doc }] },
  };

  test("follow-ups resolve in code", () => {
    expect(resolveFollowUp(lesson, [applied], "a bit more", { slideId: s2 })).toEqual({
      kind: "send",
      instruction: "a bit more",
      scope: applied.scope,
    });
    expect(
      resolveFollowUp(lesson, [applied], "slide 2 too, do the same", { slideId: s1 }),
    ).toMatchObject({ kind: "send", instruction: "Make it easier", scope: { slideId: s2 } });
    expect(resolveFollowUp(lesson, [applied], "Undo that", { slideId: s1 })).toMatchObject({
      kind: "undo",
      turn: { id: "a" },
    });
    expect(resolveFollowUp(lesson, [], "Use the word kettle", { slideId: s1 })).toEqual({
      kind: "send",
      instruction: "Use the word kettle",
      scope: { slideId: s1 },
    });
  });

  test("a change is undoable only while its boxes hold what it wrote", () => {
    const change = applied.change as NonNullable<Turn["change"]>;
    expect(canUndo(lesson, change)).toBe(true);
    const handEdited = { ...change, boxes: [{ ...change.boxes[0], after: docFromText("x") }] };
    expect(canUndo(lesson, handEdited as typeof change)).toBe(false);
  });

  test("a request in flight when the page closed reads back as stopped", () => {
    window.localStorage.setItem(
      threadKey("L"),
      JSON.stringify([{ ...applied, reply: { kind: "pending", text: "…" } }]),
    );
    expect(readThread("L")[0]?.reply.kind).toBe("stopped");
  });
});
