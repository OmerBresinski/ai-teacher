import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Lesson, SlideElement, TextElement } from "@tj/domain/documents";
import { richDocToPlainText } from "@tj/domain/documents";
import { docFromText } from "../../model/factories";
import { makeText } from "../../model/insert";
import { getTheme } from "../../model/themes";
import type { PromptEditAnswer, PromptEditPartial, PromptEditRequest } from "../proposals-context";
import { catcher, loadTextEditor, pointer, renderEditor, seededLesson } from "../test-harness";
import { EDIT_CHAT_LABEL } from "./edit-chat-context";
import {
  canUndo,
  changedSince,
  clearEditThreads,
  historyOf,
  PANE_OPEN_KEY,
  REDACTED,
  readThread,
  resolveFollowUp,
  scopeLabel,
  suggestionsFor,
  type Turn,
  threadKey,
  writeThread,
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

type Answer = (
  req: PromptEditRequest,
  signal?: AbortSignal,
  onPartial?: (partial: PromptEditPartial) => void,
) => Promise<PromptEditAnswer>;

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
  test("closing folds it into the bubble, which opens it again; the state is remembered", () => {
    const { pane } = setup(() => Promise.resolve({ action: "no-change", reason: "No change." }));
    expect(pane()).toBeTruthy();
    // No top-bar button: the bubble is the way in.
    expect(screen.queryByRole("button", { name: EDIT_CHAT_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Edit with Dayback" })).toBeNull();
    fireEvent.click(within(pane()).getByRole("button", { name: "Close Edit with Dayback" }));
    expect(screen.queryByRole("complementary", { name: EDIT_CHAT_LABEL })).toBeNull();
    expect(window.localStorage.getItem(PANE_OPEN_KEY)).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Open Edit with Dayback" }));
    expect(pane()).toBeTruthy();
    expect(window.localStorage.getItem(PANE_OPEN_KEY)).toBe("1");
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
    expect(within(pane()).getByText("Made it shorter.")).toBeTruthy();
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
    expect(within(pane).getByText("Used simpler words.")).toBeTruthy();
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
    expect(offer.className).toContain("whitespace-normal");
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

/*
 * Review of 8 Oct (blockers 1 and 2, should-fixes 3 and 5): a late answer is never applied unseen
 * or over the teacher's own typing, and one guard-rejected turn never poisons the follow-ups.
 */
describe("late answers and rejected turns", () => {
  beforeAll(loadTextEditor);

  /** A request that only answers when the test says so. */
  function deferred() {
    let resolve: (a: PromptEditAnswer) => void = () => {};
    let signal: AbortSignal | undefined;
    const answer: Answer = (_req, s) =>
      new Promise((r) => {
        signal = s;
        resolve = r;
      });
    return { answer, resolve: (a: PromptEditAnswer) => resolve(a), signal: () => signal };
  }

  const bubble = () => screen.getByRole("button", { name: /^Dayback|^Open Edit with Dayback/ });

  test("closing the pane mid-request carries on: the answer applies, and the bubble shows a dot", async () => {
    const d = deferred();
    const { say, read, lesson, pane } = setup(d.answer);
    await say("Make it harder");
    const sent = read().slides[0] as NonNullable<Lesson["slides"][number]>;
    fireEvent.click(within(pane()).getByRole("button", { name: "Close Edit with Dayback" }));
    expect(screen.queryByRole("complementary", { name: EDIT_CHAT_LABEL })).toBeNull();
    expect(d.signal()?.aborted).toBe(false);
    expect(bubble().getAttribute("aria-label")).toBe("Dayback, working");
    expect(document.activeElement).toBe(bubble());
    await act(async () => {
      d.resolve({
        action: "edit",
        changes: [{ elementId: sent.elements[0]?.id as string, doc: docFromText("Harder.") }],
        summary: "Made it harder.",
      });
    });
    expect(textOf(read())).toBe("Harder.");
    expect(bubble().getAttribute("aria-label")).toBe("Dayback, 1 new reply");
    expect(bubble().querySelector("[data-edit-chat-dot='reply']")).toBeTruthy();
    expect(document.querySelector("[data-edit-chat-announce]")?.getAttribute("role")).toBe(
      "status",
    );
    expect(document.querySelector("[data-edit-chat-announce]")?.textContent).toBe(
      "Dayback: Slide 1: Made it harder.",
    );
    expect(readThread(lesson.id).map((t) => t.reply.text)).toEqual(["Slide 1: Made it harder."]);
    fireEvent.click(bubble());
    expect(within(pane()).getByText("Made it harder.")).toBeTruthy();
    expect(document.activeElement).toBe(
      within(pane()).getByRole("textbox", { name: "What to change" }),
    );
    // Read: closing again shows the plain bubble, with no dot.
    fireEvent.click(within(pane()).getByRole("button", { name: "Close Edit with Dayback" }));
    expect(bubble().getAttribute("aria-label")).toBe("Open Edit with Dayback");
    expect(bubble().querySelector("[data-edit-chat-dot]")).toBeNull();
  });

  test("a failure while closed shows a quiet error dot, and the pane explains on open", async () => {
    const d = deferred();
    const { say, read, pane } = setup(d.answer);
    await say("Make it harder");
    fireEvent.click(within(pane()).getByRole("button", { name: "Close Edit with Dayback" }));
    await act(async () => {
      d.resolve({ action: "failed", reason: "That edit didn’t work. Try again." });
    });
    expect(textOf(read())).toBe(ORIGINAL);
    expect(bubble().getAttribute("aria-label")).toBe("Dayback, 1 new reply: that edit didn’t work");
    expect(bubble().querySelector("[data-edit-chat-dot='failed']")).toBeTruthy();
    expect(document.querySelector("[data-edit-chat-announce]")?.textContent).toBe(
      "Dayback: that edit didn’t work.",
    );
    // The bubble is a real button: keyboard focus and Enter reopen the pane.
    bubble().focus();
    expect(document.activeElement).toBe(bubble());
    await act(async () => {
      fireEvent.click(document.activeElement as HTMLElement);
    });
    expect(within(pane()).getByRole("alert").textContent).toBe("That edit didn’t work. Try again.");
  });

  test("Stop in the pane still cancels, and closing afterwards shows no dot", async () => {
    const d = deferred();
    const { say, read, pane } = setup(d.answer);
    await say("Make it harder");
    fireEvent.click(within(pane()).getByRole("button", { name: "Stop" }));
    expect(d.signal()?.aborted).toBe(true);
    expect(within(pane()).getByText("Stopped. Nothing changed.")).toBeTruthy();
    fireEvent.click(within(pane()).getByRole("button", { name: "Close Edit with Dayback" }));
    expect(bubble().getAttribute("aria-label")).toBe("Open Edit with Dayback");
    expect(textOf(read())).toBe(ORIGINAL);
  });

  test("a late answer never overwrites what the teacher typed meanwhile; it is offered again", async () => {
    const d = deferred();
    const { clickBox, say, read, pane, container, onPromptEdit } = setup(d.answer);
    clickBox();
    await say("Make it harder");
    // The teacher opens the box and types while the request is out.
    clickBox();
    fireEvent.doubleClick(catcher(container), { clientX: 550, clientY: 100 });
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull(), {
      timeout: 5_000,
    });
    const pm = container.querySelector(".ProseMirror") as HTMLElement & {
      editor: { commands: { insertContent: (s: string) => void } };
    };
    act(() => pm.editor.commands.insertContent(" Mine."));
    const typed = textOf(read());
    expect(typed).toContain("Mine.");
    await act(async () => {
      d.resolve({
        action: "edit",
        changes: [
          { elementId: read().slides[0]?.elements[0]?.id as string, doc: docFromText("Late.") },
        ],
        summary: "Made it harder.",
      });
    });
    expect(textOf(read())).toBe(typed);
    expect(within(pane()).getByRole("alert").textContent).toBe(
      "You changed that text while I was working, so I kept yours.",
    );
    await act(async () => {
      fireEvent.click(within(pane()).getByRole("button", { name: "Try again on your text" }));
    });
    const retry = onPromptEdit.mock.calls[1]?.[0] as PromptEditRequest;
    expect(retry.instruction).toBe("Make it harder");
    expect(richDocToPlainText((retry.slide.elements[0] as TextElement).doc)).toBe(typed);
  }, 15_000);

  /** Ask on box 1, then type into it while the request is out; returns the typed text. */
  async function typeWhileOut(t: ReturnType<typeof setup>) {
    t.clickBox();
    await t.say("Make it harder");
    t.clickBox();
    fireEvent.doubleClick(catcher(t.container), { clientX: 550, clientY: 100 });
    await waitFor(() => expect(t.container.querySelector(".ProseMirror")).not.toBeNull(), {
      timeout: 5_000,
    });
    const pm = t.container.querySelector(".ProseMirror") as HTMLElement & {
      editor: { commands: { insertContent: (s: string) => void } };
    };
    act(() => pm.editor.commands.insertContent(" Mine."));
    return {
      typed: textOf(t.read()),
      more: (s: string) => act(() => pm.editor.commands.insertContent(s)),
    };
  }

  test("a kept late answer shows as a preview: the teacher's text, then the suggestion", async () => {
    const d = deferred();
    const t = setup(d.answer);
    const { typed } = await typeWhileOut(t);
    await act(async () => {
      d.resolve({
        action: "edit",
        changes: [
          { elementId: t.read().slides[0]?.elements[0]?.id as string, doc: docFromText("Late.") },
        ],
        summary: "Made it harder.",
      });
    });
    const preview = t.pane().querySelector("[data-edit-late]") as HTMLElement;
    expect(preview.dataset.editLate).toBe("current");
    expect(preview.querySelector("[data-edit-late-before]")?.textContent).toBe(typed);
    expect(preview.querySelector("[data-edit-late-after]")?.textContent).toBe("Late.");
    expect(within(t.pane()).getByRole("button", { name: "Use this" })).toBeTruthy();
    expect(within(t.pane()).getByRole("button", { name: "Try again on your text" })).toBeTruthy();
    expect(textOf(t.read())).toBe(typed);
  }, 15_000);

  test("a late answer while the pane is closed: typing kept, a dot, and “Use this” waiting on reopen", async () => {
    const d = deferred();
    const t = setup(d.answer);
    const { typed } = await typeWhileOut(t);
    fireEvent.click(within(t.pane()).getByRole("button", { name: "Close Edit with Dayback" }));
    expect(d.signal()?.aborted).toBe(false);
    await act(async () => {
      d.resolve({
        action: "edit",
        changes: [
          { elementId: t.read().slides[0]?.elements[0]?.id as string, doc: docFromText("Late.") },
        ],
        summary: "Made it harder.",
      });
    });
    expect(textOf(t.read())).toBe(typed);
    const dot = screen.getByRole("button", { name: "Dayback, 1 new reply" });
    expect(dot.querySelector("[data-edit-chat-dot='reply']")).toBeTruthy();
    fireEvent.click(dot);
    const preview = t.pane().querySelector("[data-edit-late]") as HTMLElement;
    expect(preview.dataset.editLate).toBe("current");
    expect(preview.querySelector("[data-edit-late-before]")?.textContent).toBe(typed);
    await act(async () => {
      fireEvent.click(within(t.pane()).getByRole("button", { name: "Use this" }));
    });
    expect(textOf(t.read())).toBe("Late.");
    expect(t.onPromptEdit).toHaveBeenCalledTimes(1);
  }, 15_000);

  test("“Use this” applies the suggestion at once, as one undoable step", async () => {
    const d = deferred();
    const t = setup(d.answer);
    const { typed } = await typeWhileOut(t);
    await act(async () => {
      d.resolve({
        action: "edit",
        changes: [
          { elementId: t.read().slides[0]?.elements[0]?.id as string, doc: docFromText("Late.") },
        ],
        summary: "Made it harder.",
      });
    });
    await act(async () => {
      fireEvent.click(within(t.pane()).getByRole("button", { name: "Use this" }));
    });
    expect(textOf(t.read())).toBe("Late.");
    expect(t.onPromptEdit).toHaveBeenCalledTimes(1);
    expect(t.pane().querySelector("[data-edit-late]")).toBeNull();
    expect(within(t.pane()).queryByRole("button", { name: "Use this" })).toBeNull();
    expect(within(t.pane()).getByText("Made it harder.")).toBeTruthy();
    // One step: a single undo puts the teacher's text back.
    act(() => {
      fireEvent.keyDown(window, { key: "z", metaKey: true });
    });
    expect(textOf(t.read())).toBe(typed);
  }, 15_000);

  test("the suggestion goes out of date once the box changes again", async () => {
    const d = deferred();
    const t = setup(d.answer);
    const { more } = await typeWhileOut(t);
    await act(async () => {
      d.resolve({
        action: "edit",
        changes: [
          { elementId: t.read().slides[0]?.elements[0]?.id as string, doc: docFromText("Late.") },
        ],
        summary: "Made it harder.",
      });
    });
    expect(within(t.pane()).getByRole("button", { name: "Use this" })).toBeTruthy();
    more(" Again.");
    const preview = t.pane().querySelector("[data-edit-late]") as HTMLElement;
    expect(preview.dataset.editLate).toBe("stale");
    expect(preview.textContent).toContain("Out of date");
    expect(within(t.pane()).queryByRole("button", { name: "Use this" })).toBeNull();
    expect(within(t.pane()).getByRole("button", { name: "Try again on your text" })).toBeTruthy();
    expect(textOf(t.read())).toContain("Again.");
  }, 15_000);

  test("a multi-box answer lands on the untouched box and previews only the touched one", async () => {
    const lesson = textLesson();
    const first = lesson.slides[0] as NonNullable<Lesson["slides"][number]>;
    const other = { ...(first.elements[0] as TextElement), id: "other-box", y: 400 } as TextElement;
    other.doc = docFromText("Other box.");
    first.elements.push(other as SlideElement);
    const d = deferred();
    const t = setup(d.answer, lesson);
    const { typed } = await typeWhileOut(t);
    await act(async () => {
      d.resolve({
        action: "edit",
        changes: [
          { elementId: t.read().slides[0]?.elements[0]?.id as string, doc: docFromText("Late.") },
          { elementId: "other-box", doc: docFromText("Other, harder.") },
        ],
        summary: "Made it harder.",
      });
    });
    const now = t.read().slides[0]?.elements ?? [];
    expect(textOf(t.read())).toBe(typed);
    expect(richDocToPlainText((now[1] as TextElement).doc)).toBe("Other, harder.");
    const afters = [...t.pane().querySelectorAll("[data-edit-late-after]")].map(
      (e) => e.textContent,
    );
    expect(afters).toEqual(["Late."]);
    await act(async () => {
      fireEvent.click(within(t.pane()).getByRole("button", { name: "Use this" }));
    });
    expect(textOf(t.read())).toBe("Late.");
  }, 15_000);

  test("an instruction with an identifier is answered in the pane and never sent", async () => {
    const { say, pane, onPromptEdit } = setup(() =>
      Promise.resolve({ action: "no-change", reason: "" }),
    );
    await say("Add a note for jo.bloggs@school.org");
    expect(onPromptEdit).toHaveBeenCalledTimes(0);
    expect(within(pane()).getByRole("alert").textContent).toContain("email address");
  });

  test("a refused message with an identifier is not stored in clear", async () => {
    const { say, pane, lesson } = setup(() => Promise.resolve({ action: "no-change", reason: "" }));
    await say("Add a note for jo.bloggs@school.org");
    expect(within(pane()).getByRole("alert")).toBeTruthy();
    const raw = window.localStorage.getItem(threadKey(lesson.id)) ?? "";
    expect(raw).not.toContain("jo.bloggs");
    expect(readThread(lesson.id)[0]?.said).toBe(REDACTED);
    expect(readThread(lesson.id)[0]?.instruction).toBe("");
  });

  test("a model offer with an identifier is dropped, so it can never be tapped", async () => {
    const { clickBox, say, pane } = setup(() =>
      Promise.resolve({
        action: "refuse",
        reason: "That would give the answer away.",
        offer: "Add a hint for jo@school.org",
        check: "model",
      }),
    );
    clickBox();
    await say("Put the answer in the question");
    expect(within(pane()).getByRole("alert").textContent).toBe("That would give the answer away.");
    expect(pane().querySelector("[data-edit-offer]")).toBeNull();
  });

  test("failed turns and turns the guard would reject stay out of the history", () => {
    const lesson = textLesson();
    const s1 = lesson.slides[0]?.id as string;
    const turn = (instruction: string, kind: Turn["reply"]["kind"], text: string): Turn => ({
      id: instruction,
      said: instruction,
      instruction,
      scope: { slideId: s1 },
      scopeLabel: "Slide 1",
      reply: { kind, text },
    });
    const history = historyOf(lesson, [
      turn("Add 1234567 to it", "failed", "That edit didn’t work. Try again."),
      turn("Make it easier", "no-change", "No change."),
      turn("Shorter", "failed", "That edit didn’t work. Try again."),
      turn("Harder", "refuse", "Ask jo@school.org"),
      turn("Simpler", "no-change", "No change."),
    ]);
    expect(history.map((h) => h.instruction)).toEqual(["Make it easier", "Simpler"]);
  });

  test("“Try a shorter version” stays inside the instruction limit", async () => {
    const long = `Add ${"more ".repeat(98)}`.slice(0, 500);
    const { clickBox, say, pane, onPromptEdit } = setup(() =>
      Promise.resolve({ action: "refuse", reason: "Too long.", check: "fit" }),
    );
    clickBox();
    await say(long);
    await act(async () => {
      fireEvent.click(within(pane()).getByRole("button", { name: "Try a shorter version" }));
    });
    const sent = onPromptEdit.mock.calls[1]?.[0].instruction as string;
    expect(sent.length).toBeLessThanOrEqual(500);
    expect(sent.endsWith(". Keep it short.")).toBe(true);
  });

  test("changedSince: an edited or deleted box counts, an untouched one does not", () => {
    const sent = textLesson().slides[0] as NonNullable<Lesson["slides"][number]>;
    const id = sent.elements[0]?.id as string;
    expect(changedSince(sent, structuredClone(sent), [id])).toBe(false);
    const edited = structuredClone(sent);
    (edited.elements[0] as TextElement).doc = docFromText("x");
    expect(changedSince(sent, edited, [id])).toBe(true);
    expect(changedSince(sent, { ...sent, elements: [] }, [id])).toBe(true);
  });
});

describe("streamed answers", () => {
  const SHORT = "Water heats up and becomes water vapour.";
  test("partials fill the reply and the card; the slide changes only with the checked answer", async () => {
    let push: ((p: PromptEditPartial) => void) | undefined;
    let finish: ((a: PromptEditAnswer) => void) | undefined;
    let request: PromptEditRequest | undefined;
    const { say, pane, read } = setup(
      (req, _signal, onPartial) =>
        new Promise((resolve) => {
          request = req;
          push = onPartial;
          finish = resolve;
        }),
    );
    await say("Make it shorter");
    const id = request?.slide.elements[0]?.id as string;
    act(() => push?.({ summary: "Made it", texts: [] }));
    expect(within(pane()).getByText("Made it")).toBeTruthy();
    act(() =>
      push?.({ summary: "Made it shorter.", texts: [{ elementId: id, text: "Water heats up" }] }),
    );
    const card = pane().querySelector("[data-edit-card]") as HTMLElement;
    expect(card.querySelector("[data-edit-late-after]")?.textContent).toBe("Water heats up");
    expect(card.querySelector("[data-edit-late-before]")?.textContent).toBe(ORIGINAL);
    const undo = within(card).getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    // Nothing partial ever reaches the slide.
    expect(textOf(read())).toBe(ORIGINAL);
    await act(async () => {
      finish?.(edit(request as PromptEditRequest, SHORT, "Made it shorter."));
    });
    expect(textOf(read())).toBe(SHORT);
    const done = pane().querySelector("[data-edit-card]") as HTMLElement;
    expect(done.querySelector("[data-edit-late-after]")?.textContent).toBe(SHORT);
    expect((within(done).getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  test("Stop mid-stream drops the partial and changes nothing", async () => {
    let push: ((p: PromptEditPartial) => void) | undefined;
    let request: PromptEditRequest | undefined;
    const { say, pane, read } = setup(
      (req, signal, onPartial) =>
        new Promise((_resolve, reject) => {
          request = req;
          push = onPartial;
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await say("Make it shorter");
    const id = request?.slide.elements[0]?.id as string;
    act(() =>
      push?.({ summary: "Made it shorter.", texts: [{ elementId: id, text: "Water heats" }] }),
    );
    expect(pane().querySelector("[data-edit-card]")).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(pane()).getAllByRole("button", { name: "Stop" })[0] as HTMLElement);
    });
    expect(within(pane()).getByText("Stopped. Nothing changed.")).toBeTruthy();
    expect(pane().querySelector("[data-edit-card]")).toBeNull();
    // A partial that arrives after Stop is ignored.
    act(() =>
      push?.({ summary: "Made it shorter.", texts: [{ elementId: id, text: "Water heats up" }] }),
    );
    expect(pane().querySelector("[data-edit-card]")).toBeNull();
    expect(textOf(read())).toBe(ORIGINAL);
  });
});

describe("request lifetime and stored threads", () => {
  test("a resize to the mobile layout does not cancel a request, and its answer still applies", async () => {
    let mobile = false;
    const listeners = new Set<(e: { matches: boolean }) => void>();
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("760px") ? mobile : false,
      media: query,
      onchange: null,
      addEventListener: (_: string, l: (e: { matches: boolean }) => void) => {
        if (query.includes("760px")) listeners.add(l);
      },
      removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.delete(l),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    })) as unknown as typeof window.matchMedia;
    try {
      let seen: AbortSignal | undefined;
      let finish: ((a: PromptEditAnswer) => void) | undefined;
      let request: PromptEditRequest | undefined;
      const { say, read, unmount } = setup(
        (req, signal) =>
          new Promise((resolve) => {
            request = req;
            seen = signal;
            finish = resolve;
          }),
      );
      await say("Make it shorter");
      act(() => {
        mobile = true;
        for (const l of listeners) l({ matches: true });
      });
      expect(screen.queryByRole("complementary", { name: EDIT_CHAT_LABEL })).toBeNull();
      expect(seen?.aborted).toBe(false);
      await act(async () => {
        finish?.(edit(request as PromptEditRequest, "Short.", "Made it shorter."));
      });
      // The answer still applied while the pane was gone.
      expect(textOf(read())).toBe("Short.");
      unmount();
      expect(seen?.aborted).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  test("leaving the editor mid-request cancels it", async () => {
    let seen: AbortSignal | undefined;
    const { say, unmount } = setup(
      (_req, signal) =>
        new Promise(() => {
          seen = signal;
        }),
    );
    await say("Make it shorter");
    unmount();
    expect(seen?.aborted).toBe(true);
  });

  test("threads are kept per user and lesson, and sign-out clears them all", () => {
    const turn = {
      id: "t1",
      said: "Shorter",
      instruction: "Make it shorter",
      scope: {},
      scopeLabel: "Slide 1",
      reply: { kind: "edit", text: "Slide 1: Made it shorter." },
    } as Turn;
    writeThread("lesson-1", [turn], "user-a");
    expect(readThread("lesson-1", "user-a")).toHaveLength(1);
    expect(readThread("lesson-1", "user-b")).toHaveLength(0);
    expect(threadKey("lesson-1", "user-a")).not.toBe(threadKey("lesson-1", "user-b"));
    window.localStorage.setItem("unrelated", "1");
    clearEditThreads();
    expect(readThread("lesson-1", "user-a")).toHaveLength(0);
    expect(window.localStorage.getItem("unrelated")).toBe("1");
  });
});
