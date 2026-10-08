import { type CreatedAi, createBudget } from "@tj/ai";
import {
  type Lesson,
  plainTextOf,
  type RichDoc,
  type RichNode,
  richDocToPlainText,
  type Slide,
  type SlideElement,
} from "@tj/domain/documents";
import { getTheme, lintAsDrawn, measureHeadless } from "@tj/slides";
import type { Logger } from "pino";
import { z } from "zod";
import { callStructured } from "./call";
import { type EditFastInput, editFastPrompt } from "./prompts/edit-fast";
import type { PipelineContext } from "./types";

/*
 * Edit with a prompt, fast path (TEACH-97 part d; rulings 171, 172, 173, 175, 176). A teacher
 * selects a text box and asks for a change; one call on gpt-6-luna with reasoning off rewrites
 * that box and nothing else. The answer is applied to a copy of the slide and checked with the
 * same code generation uses: the headless fit lint (`lintAsDrawn`, overflow and collisions as
 * drawn) and an answer-leak check. A failed check gets one retry with the faults; a second
 * failure is refused in teacher words and changes nothing. Design and measurements:
 * `scratchpad/quality-prd/research/edit-agent/` (DESIGN.md §2, RESULTS.md).
 *
 * Until the slide spec is saved (part c), the editable node is the element's text, addressed
 * `s<n>/elements/<id>/text`; the slide's arrangement is never touched (ruling 173). Pure apart
 * from the injected `ai`; nothing here logs text (ADR 0015).
 */

/** Decided 7 Oct 2026 (RESULTS.md "Ship recommendation"): Luna, reasoning off. Code, not env. */
export const EDIT_FAST_MODEL_ID = "openai/gpt-6-luna";
export const EDIT_FAST_EFFORT = "none" as const;
/** Per attempt. The measured p90 is 1.9 s; a call past this is lost, not slow. */
export const EDIT_FAST_TIMEOUT_MS = 8000;
/** A rewrite of one box is a few hundred tokens; the cap is never why it fails. */
export const EDIT_FAST_MAX_OUTPUT_TOKENS = 1500;
const EDIT_FAST_BUDGET = { capUsd: 0.02, capTokens: 40_000 };
export const EDIT_INSTRUCTION_MAX = 500;

/** The v2 fast schema: exactly one of `text` / `node_json` per change (checked in code). */
export const EditFastOutputSchema = z.object({
  action: z.enum(["edit", "refuse", "escalate"]),
  reason: z.string().nullable(),
  changes: z.array(
    z.object({ target: z.string(), text: z.string().nullable(), node_json: z.string().nullable() }),
  ),
  summary: z.string(),
});
export type EditFastOutput = z.infer<typeof EditFastOutputSchema>;

/** Teacher-facing refusals written by code (the model's own refusal reason is shown as is). */
export const EDIT_MESSAGES = {
  wontFit: "That won’t fit on this slide. Try a shorter change.",
  leaksAnswer: "That would give away the answer on this slide.",
  needsMore: "That needs more than a change to this text, which isn’t available here yet.",
  noChange: "No change.",
  failed: "That edit didn’t work. Try again, or word it differently.",
} as const;

export type EditFastRequest = {
  lesson: Lesson;
  /** The slide as the editor holds it now (it may be ahead of the saved lesson). */
  slide: Slide;
  /** The selected text box; absent → the whole slide (any of its text boxes may change). */
  elementId?: string | undefined;
  instruction: string;
};

/** One text box's new content. */
export type EditFastChange = { elementId: string; doc: RichDoc; text: string };

export type EditFastResult =
  | {
      action: "edit";
      /** Every box the edit changed, on the request's slide; one box at element scope. */
      changes: EditFastChange[];
      summary: string;
      attempts: number;
      ms: number;
      modelId: string;
    }
  | {
      action: "refuse" | "escalate" | "no-change";
      reason: string;
      attempts: number;
      ms: number;
      /** Which check refused, when code refused: logged, and picks the pane's one-tap alternative. */
      check?: "fit" | "leak" | "scope" | "shape" | "model" | undefined;
    };

export interface EditFastDeps {
  ai: CreatedAi;
  logger: Logger;
  signal?: AbortSignal | undefined;
  context?: PipelineContext | undefined;
}

export class EditTargetError extends Error {}

/* ------------------------------------------------------------------ */
/* Packing                                                            */
/* ------------------------------------------------------------------ */

const textOfElement = (el: SlideElement): string =>
  el.type === "text" ? richDocToPlainText(el.doc) : (plainTextOf(el as never) ?? "");

const isHeading = (el: SlideElement) =>
  el.type === "text" && (el.style.preset === "title" || el.style.preset === "heading");

function headingOf(slide: Slide): string | undefined {
  const texts = slide.elements.filter((e) => e.type === "text");
  const first = texts.find(isHeading) ?? texts[0];
  const text = first ? textOfElement(first).trim() : "";
  return text === "" ? undefined : text.split("\n")[0];
}

function lessonLine(lesson: Lesson): string {
  const year = lesson.yearGroup ?? "";
  const subject = lesson.subject ?? "";
  const topic = lesson.brief?.topic ?? lesson.title;
  const head = [year, subject].filter(Boolean).join(" ");
  const level = lesson.brief?.level ?? "standard";
  const reading = lesson.readingLevel ? `, reading level ${lesson.readingLevel}` : "";
  return `${head ? `${head}: ` : ""}${topic}. Challenge ${level}${reading}.`;
}

export const slidePathOf = (lesson: Lesson, slideId: string): string => {
  const i = lesson.slides.findIndex((s) => s.id === slideId);
  return `s${i < 0 ? lesson.slides.length + 1 : i + 1}`;
};

export const targetOf = (slidePath: string, elementId: string) =>
  `${slidePath}/elements/${elementId}/text`;

/** The user turn's input: the lesson with the editor's current slide laid over the saved one. */
export function packEditFast(req: EditFastRequest): EditFastInput {
  const el =
    req.elementId === undefined
      ? undefined
      : req.slide.elements.find((e) => e.id === req.elementId);
  if (req.elementId !== undefined && el?.type !== "text")
    throw new EditTargetError("the selection is not a text box");
  if (req.elementId === undefined && !req.slide.elements.some((e) => e.type === "text"))
    throw new EditTargetError("the slide has no text to edit");
  const slides = req.lesson.slides.map((s) => (s.id === req.slide.id ? req.slide : s));
  const slidePath = slidePathOf(req.lesson, req.slide.id);
  const elements: Record<string, { text: string }> = {};
  for (const e of req.slide.elements) {
    const text = textOfElement(e).trim();
    if (text !== "") elements[e.id] = { text };
  }
  return {
    lesson: lessonLine(req.lesson),
    objectives: (req.lesson.facts?.objectives ?? []).map((o) => o.text),
    outline: slides.map((s, i) => {
      const heading = headingOf(s);
      return `s${i + 1} ${s.kind}${heading ? ` "${heading}"` : ""}`;
    }),
    slidePath,
    slideJson: JSON.stringify({ kind: req.slide.kind, elements }),
    ...(el?.type === "text"
      ? { target: targetOf(slidePath, el.id), text: richDocToPlainText(el.doc) }
      : { target: slidePath }),
    instruction: req.instruction,
  };
}

/* ------------------------------------------------------------------ */
/* Applying                                                           */
/* ------------------------------------------------------------------ */

const LIST_TYPES = new Set(["bulletList", "orderedList"]);

/**
 * Plain text back into the box's doc. A box that was one list stays that list, one item per line;
 * anything else becomes one paragraph per line (the harness's RichDoc wrap). Marks are dropped:
 * the model writes plain text.
 */
export function textToDoc(text: string, original: RichDoc): RichDoc {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const para = (t: string): RichNode => ({
    type: "paragraph",
    content: [{ type: "text", text: t }],
  });
  const only = original.content?.length === 1 ? original.content[0] : undefined;
  if (only && LIST_TYPES.has(only.type)) {
    const list: RichNode = {
      type: only.type,
      ...(only.attrs ? { attrs: only.attrs } : {}),
      content: lines.map((t) => ({ type: "listItem", content: [para(t)] })),
    };
    return { type: "doc", content: [list] };
  }
  return { type: "doc", content: lines.map(para) };
}

type Applied = { changes: EditFastChange[]; slide: Slide } | { fault: string };

const ELEMENT_TEXT = /^(s\d+)\/elements\/([^/]+)\/text$/;

/** One change's new value as text, or the fault that stops it. */
function changeText(change: EditFastOutput["changes"][number]): unknown | { fault: string } {
  const hasText = change.text !== null;
  const hasNode = change.node_json !== null;
  if (hasText === hasNode)
    return { fault: `${change.target}: set exactly one of text or node_json` };
  if (hasText) return change.text;
  try {
    return JSON.parse(change.node_json as string);
  } catch {
    return { fault: `node_json for ${change.target} is not JSON` };
  }
}

const isFault = (x: unknown): x is { fault: string } =>
  typeof x === "object" && x !== null && "fault" in x;

/**
 * The model's changes, held to the selection. At element scope (`target` names a box): exactly
 * one change, on that box, as text. At slide scope (`target` is the slide, `s4`): one change per
 * text box, each on `s4/elements/<id>/text`, or the slide node itself as
 * `{ elements: { <id>: { text } } }`; nothing outside the slide's text boxes.
 */
export function applyEdit(out: EditFastOutput, target: string, slide: Slide): Applied {
  const elementScope = ELEMENT_TEXT.test(target);
  if (elementScope && out.changes.length !== 1)
    return { fault: `change exactly one node: ${target}` };
  const texts = new Map<string, string>();
  for (const change of out.changes) {
    const value = changeText(change);
    if (isFault(value)) return value;
    if (!elementScope && change.target === target) {
      const elements = (value as { elements?: unknown } | null)?.elements;
      if (typeof elements !== "object" || elements === null)
        return { fault: `${target}: give each changed text box as elements.<id>.text` };
      for (const [id, node] of Object.entries(elements as Record<string, unknown>)) {
        const t = (node as { text?: unknown } | null)?.text;
        if (typeof t !== "string") return { fault: `${target}/elements/${id}: text is a string` };
        texts.set(id, t);
      }
      continue;
    }
    const m = change.target.match(ELEMENT_TEXT);
    const inScope = elementScope ? change.target === target : m?.[1] === target;
    if (!inScope || !m) return { fault: `scope: ${change.target} is outside the selection` };
    if (typeof value !== "string")
      return { fault: `${change.target}: is text; put the new text in text` };
    texts.set(m[2] as string, value);
  }
  const changes: EditFastChange[] = [];
  for (const [id, text] of texts) {
    const el = slide.elements.find((e) => e.id === id);
    if (el?.type !== "text") return { fault: `scope: ${id} is not a text box on this slide` };
    const doc = textToDoc(text, el.doc);
    const now = richDocToPlainText(doc);
    if (now.trim() !== richDocToPlainText(el.doc).trim())
      changes.push({ elementId: id, doc, text: now });
  }
  const byId = new Map(changes.map((c) => [c.elementId, c]));
  const elements = slide.elements.map((e) => {
    const c = byId.get(e.id);
    return c && e.type === "text" ? { ...e, doc: c.doc } : e;
  });
  return { changes, slide: { ...slide, elements } };
}

/* ------------------------------------------------------------------ */
/* Checks: the same code generation and the editor use                */
/* ------------------------------------------------------------------ */

/** Fit as drawn (`lintAsDrawn`): faults the edit introduced on the edited box only. */
export function fitFaults(
  before: Slide,
  after: Slide,
  elementId: string,
  themeId: string,
): string[] {
  const theme = getTheme(themeId);
  const measure = measureHeadless(theme);
  const was = lintAsDrawn(before, measure, theme);
  const now = lintAsDrawn(after, measure, theme);
  const touches = (pair: [string, string]) => pair.includes(elementId);
  const key = (pair: [string, string]) => [...pair].sort().join("|");
  const overlapsBefore = new Set(was.overlaps.filter(touches).map(key));
  const faults: string[] = [];
  if (now.overflow.includes(elementId) && !was.overflow.includes(elementId))
    faults.push("the new text does not fit its box on the slide; make it shorter");
  if (now.overlaps.filter(touches).some((p) => !overlapsBefore.has(key(p))))
    faults.push("the new text grows its box into another part of the slide; make it shorter");
  if (now.laneOverflow.includes(elementId) && !was.laneOverflow.includes(elementId))
    faults.push("the new text runs into the space kept for the answer; make it shorter");
  return faults;
}

const STOP = new Set(["the", "and", "its", "his", "her", "their", "which", "what"]);
const words = (x: string) =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));

/** Three or more consecutive content words of the answer appear in the text (the harness's rule). */
export function echoes(text: string, answer: string): boolean {
  const a = words(answer);
  const q = ` ${words(text).join(" ")} `;
  if (a.length === 1) return q.includes(` ${a[0]} `);
  for (let i = 0; i + 3 <= a.length; i++)
    if (q.includes(` ${a.slice(i, i + 3).join(" ")} `)) return true;
  return false;
}

/** The answers a question slide keys, and the ids of the elements that show them. */
function answersOf(slide: Slide): { answers: string[]; answerIds: Set<string> } {
  const q = slide.question;
  const byId = new Map(slide.elements.map((e) => [e.id, e]));
  if (q?.type === "multiple-choice") {
    const right = q.options.filter((o) => o.correct).map((o) => o.id);
    return {
      answers: right.map((id) => (byId.get(id) ? textOfElement(byId.get(id) as SlideElement) : "")),
      answerIds: new Set(right),
    };
  }
  if (q?.type === "fill-gap") return { answers: q.gaps.map((g) => g.answer), answerIds: new Set() };
  if (q?.type === "open-response" && q.modelAnswer)
    return { answers: [q.modelAnswer], answerIds: new Set() };
  return { answers: [], answerIds: new Set() };
}

/** A question slide whose edited text now states a keyed answer it did not state before. */
export function leakFaults(before: Slide, after: Slide, elementId: string): string[] {
  const { answers, answerIds } = answersOf(before);
  if (answerIds.has(elementId)) return [];
  const textIn = (s: Slide) => {
    const el = s.elements.find((e) => e.id === elementId);
    return el ? textOfElement(el) : "";
  };
  const was = textIn(before);
  const now = textIn(after);
  const faults = answers
    .filter((a) => a.trim() !== "" && echoes(now, a) && !echoes(was, a))
    .map((a) => `the new text gives away the answer "${a}"; do not state it`);
  for (const letter of keyedLetters(before)) {
    if (letterCount(now, letter) > letterCount(was, letter))
      faults.push(`the new text gives away the answer by naming option ${letter}; do not name it`);
  }
  return faults;
}

/** The letters a multiple-choice slide shows on its correct options (A for the first option). */
function keyedLetters(slide: Slide): string[] {
  const q = slide.question;
  if (q?.type !== "multiple-choice") return [];
  return q.options.flatMap((o, i) => (o.correct ? [String.fromCharCode(65 + i)] : []));
}

/** A letter standing alone ("(B)", "B.", "option B"); the article "A word" does not count. */
const letterCount = (text: string, letter: string): number =>
  [...text.matchAll(new RegExp(`(?<![A-Za-z’'])${letter}(?![A-Za-z’'])(?! [a-z])`, "g"))].length;

/* ------------------------------------------------------------------ */
/* The call                                                           */
/* ------------------------------------------------------------------ */

export async function editFast(req: EditFastRequest, deps: EditFastDeps): Promise<EditFastResult> {
  const start = performance.now();
  const ms = () => Math.round(performance.now() - start);
  const input = packEditFast(req);
  const budget = createBudget(EDIT_FAST_BUDGET);
  // Two rounds, each with `callStructured`'s own shape retry: never an unbounded wait.
  const deadline = AbortSignal.timeout(EDIT_FAST_TIMEOUT_MS * 3);
  const signal = deps.signal ? AbortSignal.any([deps.signal, deadline]) : deadline;
  const call = (retry?: EditFastInput["retry"]) =>
    callStructured({
      deps: {
        ai: deps.ai,
        budget,
        signal,
        logger: deps.logger,
        context: deps.context ?? { lessonId: req.lesson.id, jobId: "" },
      },
      stage: "edit-fast",
      cls: "small",
      effort: EDIT_FAST_EFFORT,
      prompt: editFastPrompt,
      input: retry ? { ...input, retry } : input,
      schema: EditFastOutputSchema,
      maxOutputTokens: EDIT_FAST_MAX_OUTPUT_TOKENS,
      timeoutMs: EDIT_FAST_TIMEOUT_MS,
    });

  let attempts = 0;
  let retry: EditFastInput["retry"];
  let lastCheck: "fit" | "leak" | "scope" | "shape" = "shape";
  for (let round = 0; round < 2; round++) {
    const result = await call(retry);
    attempts += result.attempts;
    const out = result.output;
    if (out.action === "refuse")
      return {
        action: "refuse",
        reason: out.reason?.trim() || EDIT_MESSAGES.failed,
        attempts,
        ms: ms(),
        check: "model",
      };
    if (out.action === "escalate")
      return {
        action: "escalate",
        reason: EDIT_MESSAGES.needsMore,
        attempts,
        ms: ms(),
        check: "model",
      };
    if (out.changes.length === 0)
      return { action: "no-change", reason: EDIT_MESSAGES.noChange, attempts, ms: ms() };
    const applied = applyEdit(out, input.target, req.slide);
    let faults: string[];
    if ("fault" in applied) {
      faults = [applied.fault];
      lastCheck = applied.fault.startsWith("scope") ? "scope" : "shape";
    } else {
      if (applied.changes.length === 0)
        return { action: "no-change", reason: EDIT_MESSAGES.noChange, attempts, ms: ms() };
      faults = [];
      let leaked = false;
      for (const c of applied.changes) {
        const at = targetOf(input.slidePath, c.elementId);
        if (c.text.trim() === "") {
          faults.push(`${at}: the text is empty`);
          continue;
        }
        const leak = leakFaults(req.slide, applied.slide, c.elementId);
        const fit = fitFaults(req.slide, applied.slide, c.elementId, req.lesson.themeId);
        if (leak.length > 0) leaked = true;
        faults.push(...[...leak, ...fit].map((f) => `${at}: ${f}`));
      }
      lastCheck = leaked ? "leak" : "fit";
      if (faults.length === 0)
        return {
          action: "edit",
          changes: applied.changes,
          summary: out.summary.trim(),
          attempts,
          ms: ms(),
          modelId: result.modelId,
        };
    }
    retry = {
      faults: faults.map((f) => (f.startsWith(`${input.target}`) ? f : `${input.target}: ${f}`)),
      previous: JSON.stringify(out),
    };
  }
  const reason =
    lastCheck === "leak"
      ? EDIT_MESSAGES.leaksAnswer
      : lastCheck === "fit"
        ? EDIT_MESSAGES.wontFit
        : EDIT_MESSAGES.failed;
  return { action: "refuse", reason, attempts, ms: ms(), check: lastCheck };
}
