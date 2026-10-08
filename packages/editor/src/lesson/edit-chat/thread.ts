import {
  findNamePatterns,
  type Id,
  type Lesson,
  type RichDoc,
  type Slide,
  type SlideElement,
} from "@tj/domain/documents";
import { EDIT_THREAD_PREFIX } from "./thread-storage";

export { clearEditThreads, EDIT_THREAD_PREFIX } from "./thread-storage";

/*
 * The "Edit with Dayback" thread (TEACH-97; rulings 172, 175, 176): what the chat pane keeps per
 * lesson, and the code that resolves a follow-up from it. Pure apart from `localStorage`, which is
 * read and written through the guarded helpers at the bottom (a private window may refuse it).
 */

/** What a message acts on. `slideId` absent → the whole lesson. */
export type EditScope = { slideId?: Id | undefined; elementId?: Id | undefined };

/** One box before and after an applied change: enough to undo it, even after a reload. */
export type BoxChange = { elementId: Id; before: RichDoc; after: RichDoc };

export type ReplyKind = "pending" | "edit" | "refuse" | "no-change" | "failed" | "stopped" | "undo";

/** A one-tap alternative under a refusal: the message it sends and the scope it sends it on. */
export type Alternative = { label: string; instruction: string; scope: EditScope };

export type Turn = {
  id: string;
  /** What the teacher typed or tapped, as shown. */
  said: string;
  /** What was sent: `said`, or the instruction a follow-up resolved to. */
  instruction: string;
  scope: EditScope;
  /** The scope as the chip showed it ("Slide 4 · text box"). */
  scopeLabel: string;
  reply: { kind: ReplyKind; text: string; alternative?: Alternative | undefined };
  /** The applied change (reply kind "edit"). */
  change?: { slideId: Id; boxes: BoxChange[]; undone?: boolean | undefined } | undefined;
  /**
   * A late answer for boxes the teacher typed in while it was out: their text was kept, and the
   * answer waits here as a preview they can still use. `before` is the teacher's text when it
   * arrived, `after` the suggested text. Usable while every box still holds `before`.
   */
  late?:
    | { slideId: Id; summary: string; boxes: BoxChange[]; used?: boolean | undefined }
    | undefined;
};

export const THREAD_LIMIT = 50;

/* ------------------------------------------------------------------ */
/* Scope                                                              */
/* ------------------------------------------------------------------ */

const KIND_LABEL: Partial<Record<SlideElement["type"], string>> = {
  text: "text box",
  image: "picture",
  shape: "shape",
  line: "line",
  path: "drawing",
  icon: "icon",
  table: "table",
  embed: "embed",
  option: "answer option",
  "gap-text": "gap text",
  timer: "timer",
  group: "group",
};

export function slideNumber(lesson: Lesson, slideId: Id | undefined): number {
  return slideId ? lesson.slides.findIndex((s) => s.id === slideId) + 1 : 0;
}

/** The chip's words for a scope. */
export function scopeLabel(lesson: Lesson, scope: EditScope, selectionCount = 1): string {
  const n = slideNumber(lesson, scope.slideId);
  if (n <= 0) return "Whole lesson";
  if (selectionCount > 1) return `Slide ${n} · ${selectionCount} items`;
  if (!scope.elementId) return `Slide ${n}`;
  const el = lesson.slides[n - 1]?.elements.find((e) => e.id === scope.elementId);
  const kind = el ? (KIND_LABEL[el.type] ?? "item") : "item";
  return `Slide ${n} · ${kind}`;
}

/**
 * The scope the selection gives: one selected text box → that box; anything else selected, or
 * nothing → the slide on the canvas. Only text can be edited without the agent path.
 */
export function scopeOf(lesson: Lesson, slideId: Id | null, selection: readonly Id[]): EditScope {
  if (!slideId) return {};
  const slide = lesson.slides.find((s) => s.id === slideId);
  if (!slide) return {};
  if (selection.length === 1) {
    const el = slide.elements.find((e) => e.id === selection[0]);
    if (el) return { slideId, elementId: el.id };
  }
  return { slideId };
}

/** The element a scope names, when it names one. */
export function scopedElement(lesson: Lesson, scope: EditScope): SlideElement | undefined {
  const slide = lesson.slides.find((s) => s.id === scope.slideId);
  return scope.elementId ? slide?.elements.find((e) => e.id === scope.elementId) : undefined;
}

/* ------------------------------------------------------------------ */
/* Suggestions (ruling 175)                                           */
/* ------------------------------------------------------------------ */

/** The one-tap suggestions whose path works today: text edits on a text box or a slide. */
export const TEXT_SUGGESTIONS = [
  { label: "Easier", instruction: "Make it easier" },
  { label: "Harder", instruction: "Make it harder" },
  { label: "Shorter", instruction: "Make it shorter" },
  { label: "Turn into a question", instruction: "Turn it into a question" },
] as const;

export type Suggestion = (typeof TEXT_SUGGESTIONS)[number];

/**
 * The suggestions for a scope. "Add a picture" (slots) and "Animate" (diagrams) need the agent
 * path, which waits on the saved slide spec (part c): they are not offered until it exists.
 */
export function suggestionsFor(lesson: Lesson, scope: EditScope): readonly Suggestion[] {
  if (!scope.slideId) return [];
  const el = scopedElement(lesson, scope);
  if (el && el.type !== "text") return [];
  const slide = lesson.slides.find((s) => s.id === scope.slideId);
  return slide?.elements.some((e) => e.type === "text") ? TEXT_SUGGESTIONS : [];
}

/* ------------------------------------------------------------------ */
/* Follow-ups (code, not the model)                                   */
/* ------------------------------------------------------------------ */

const UNDO = /^\s*(undo( that| it)?|go back|put it back|revert( that| it)?|change it back)\b/i;
const MODIFIER =
  /^\s*(a bit more|a little more|bit more|more|even more|a bit less|less|again|same again)\b[\s.!]*$/i;
const SAME =
  /\b(do the same|same again|same to|same on|same for|that one too|this one too|these too|those too)\b/i;

export type Resolved =
  | { kind: "undo"; turn: Turn | undefined }
  | { kind: "send"; instruction: string; scope: EditScope; note?: string | undefined };

/** The last applied change that is not undone. */
export function lastApplied(thread: readonly Turn[]): Turn | undefined {
  return [...thread].reverse().find((t) => t.reply.kind === "edit" && !t.change?.undone);
}

/** The instruction a "do the same" or "a bit more" repeats: the last applied, non-follow-up one. */
function baseInstruction(thread: readonly Turn[]): Turn | undefined {
  return [...thread]
    .reverse()
    .find(
      (t) =>
        t.reply.kind === "edit" &&
        !MODIFIER.test(t.said) &&
        !SAME.test(t.said) &&
        !UNDO.test(t.said),
    );
}

/**
 * A follow-up resolved in code (research `chain.ts` `resolve`): "next slide", "previous slide" and
 * "slide N" move the scope to that slide; "do the same" and "that one too" repeat the last applied
 * instruction there; "a bit more" or "again" go, as said, to the last change's target (the history
 * says what they refer to); "undo that" reverts the last applied change. Anything else is sent as typed, on the chip's scope.
 */
export function resolveFollowUp(
  lesson: Lesson,
  thread: readonly Turn[],
  said: string,
  scope: EditScope,
): Resolved {
  const text = said.trim();
  if (UNDO.test(text)) return { kind: "undo", turn: lastApplied(thread) };
  const lower = text.toLowerCase();
  const order = lesson.slides.map((s) => s.id);
  const anchor = scope.slideId ?? lastApplied(thread)?.change?.slideId;
  const at = anchor ? order.indexOf(anchor) : -1;
  const n = lower.match(/\bslide (\d+)\b/);
  let to: Id | undefined;
  if (/\b(next|following) slide\b/.test(lower) && at >= 0) to = order[at + 1];
  else if (/\bprevious slide\b/.test(lower) && at > 0) to = order[at - 1];
  else if (n) to = order[Number(n[1]) - 1];
  const moved: EditScope = to ? { slideId: to } : scope;
  const base = baseInstruction(thread);
  if (base && SAME.test(lower))
    return { kind: "send", instruction: base.instruction, scope: moved, note: base.said };
  // "a bit more" is sent as said, on the last change's target: the thread history in the request
  // tells the model what "more" refers to.
  if (base && MODIFIER.test(text)) return { kind: "send", instruction: text, scope: base.scope };
  return { kind: "send", instruction: text, scope: moved };
}

/** Whether text would trip the server's input guard (an email, an ID number, "a pupil called"). */
export const hasIdentifier = (text: string) => findNamePatterns(text).length > 0;

/**
 * The thread's last 3 finished turns, oldest first, as the fast call's history: what was asked,
 * the reply the teacher saw, and the slides a change touched (`s4`). A failed turn is left out,
 * and so is any turn the server's input guard would reject: otherwise one bad turn would fail
 * every follow-up on the slide until it aged out (the thread outlives a reload).
 */
export function historyOf(
  lesson: Lesson,
  thread: readonly Turn[],
): { instruction: string; summary: string; slides: string[] }[] {
  return thread
    .filter(
      (t) => t.reply.kind !== "pending" && t.reply.kind !== "failed" && t.instruction.trim() !== "",
    )
    .map((t) => {
      const n = t.change && !t.change.undone ? slideNumber(lesson, t.change.slideId) : 0;
      return {
        instruction: (t.instruction === "undo" ? t.said : t.instruction).slice(0, 500),
        summary: t.reply.text.slice(0, 300),
        slides: n > 0 ? [`s${n}`] : [],
      };
    })
    .filter((h) => !hasIdentifier(h.instruction) && !hasIdentifier(h.summary))
    .slice(-3);
}

/* ------------------------------------------------------------------ */
/* Undo of one change                                                 */
/* ------------------------------------------------------------------ */

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether any of these boxes holds something else now than in the slide that was sent: the
 * teacher typed while the request was out, or deleted the box. A late answer is then never
 * written over their text (ruling 173).
 */
export function changedSince(sent: Slide, now: Slide, ids: readonly Id[]): boolean {
  return ids.some((id) => {
    const was = sent.elements.find((e) => e.id === id);
    const is = now.elements.find((e) => e.id === id);
    return was?.type !== "text" || is?.type !== "text" || !same(was.doc, is.doc);
  });
}

/**
 * Split a late answer by what the teacher did meanwhile: boxes still as sent can be applied;
 * boxes they typed in are kept, with the answer's text as a suggestion (`before` = their text
 * now); boxes deleted since are dropped.
 */
export function splitLate(
  sent: Slide,
  now: Slide,
  changes: readonly { elementId: Id; doc: RichDoc }[],
): { apply: BoxChange[]; kept: BoxChange[] } {
  const apply: BoxChange[] = [];
  const kept: BoxChange[] = [];
  for (const c of changes) {
    const was = sent.elements.find((e) => e.id === c.elementId);
    const is = now.elements.find((e) => e.id === c.elementId);
    if (is?.type !== "text") continue;
    const box = { elementId: c.elementId, before: is.doc, after: c.doc };
    if (was?.type === "text" && same(was.doc, is.doc)) apply.push(box);
    else kept.push(box);
  }
  return { apply, kept };
}

/**
 * Whether a kept suggestion can still be used: not used yet, and every box still holds the text
 * the teacher had when it arrived. Any further change to a box puts it out of date.
 */
export function lateIsCurrent(lesson: Lesson, late: NonNullable<Turn["late"]>): boolean {
  if (late.used) return false;
  const slide = lesson.slides.find((s) => s.id === late.slideId);
  if (!slide) return false;
  return late.boxes.every((b) => {
    const el = slide.elements.find((e) => e.id === b.elementId);
    return el?.type === "text" && same(el.doc, b.before);
  });
}

/**
 * Whether a change can be undone exactly: every box it touched still holds what the change wrote.
 * A box edited by hand since, or deleted, is never overwritten (ruling 173).
 */
export function canUndo(lesson: Lesson, change: NonNullable<Turn["change"]>): boolean {
  if (change.undone) return false;
  const slide = lesson.slides.find((s) => s.id === change.slideId);
  if (!slide) return false;
  return change.boxes.every((b) => {
    const el = slide.elements.find((e) => e.id === b.elementId);
    return el?.type === "text" && same(el.doc, b.after);
  });
}

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */

export const PANE_OPEN_KEY = "dayback.edit-pane.open";
/** A thread is kept per user and lesson, so a shared computer never shows one teacher's to another. */
export const threadKey = (lessonId: string, userId = "") =>
  `${EDIT_THREAD_PREFIX}${userId ? `${userId}.` : ""}${lessonId}`;

export function readPaneOpen(): boolean {
  try {
    return window.localStorage.getItem(PANE_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePaneOpen(open: boolean): void {
  try {
    window.localStorage.setItem(PANE_OPEN_KEY, open ? "1" : "0");
  } catch {
    // A private window: the pane just starts closed next time.
  }
}

export function readThread(lessonId: string, userId = ""): Turn[] {
  try {
    const raw = window.localStorage.getItem(threadKey(lessonId, userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // A request in flight when the page closed never answered: say so rather than spin forever.
    return (parsed as Turn[]).map((t) =>
      t.reply.kind === "pending"
        ? { ...t, reply: { kind: "stopped", text: "Stopped. Nothing changed." } }
        : t,
    );
  } catch {
    return [];
  }
}

/** What the stored thread keeps in place of a message that held an identifier. */
export const REDACTED = "(Removed: it had an email address, an ID number or a pupil’s name.)";

/**
 * A turn as stored: a message with an identifier (refused before it was sent) is never written to
 * the browser in clear. Its instruction is emptied too, so it never reaches a follow-up's history.
 */
const storable = (t: Turn): Turn =>
  hasIdentifier(t.said) || hasIdentifier(t.instruction)
    ? { ...t, said: REDACTED, instruction: "" }
    : t;

export function writeThread(lessonId: string, thread: readonly Turn[], userId = ""): void {
  try {
    window.localStorage.setItem(
      threadKey(lessonId, userId),
      JSON.stringify(thread.slice(-THREAD_LIMIT).map(storable)),
    );
  } catch {
    // Storage full or refused: the thread lives for this page only.
  }
}
