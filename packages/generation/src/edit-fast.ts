import { type Budget, type CreatedAi, createBudget } from "@tj/ai";
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
import { type PipelineContext, StageFailure } from "./types";

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
  /** A refusal's one-tap offer: an instruction the teacher could send instead, else null. */
  offer: z.string().nullable(),
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

/** Said when a follow-up twice went the wrong way: names the direction that was asked for. */
export const directionMessage = (dir: EditDirection): string =>
  `I couldn’t make it ${dir} this time, so I left it as it was. Try saying exactly what to change.`;

export type EditFastRequest = {
  lesson: Lesson;
  /** The slide as the editor holds it now (it may be ahead of the saved lesson). */
  slide: Slide;
  /** The selected text box; absent → the whole slide (any of its text boxes may change). */
  elementId?: string | undefined;
  instruction: string;
  /** The thread's last turns, oldest first (the prompt shows 3); `slides` are paths (`s4`). */
  history?: EditFastInput["history"];
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
      check?: "fit" | "leak" | "scope" | "shape" | "model" | "direction" | undefined;
      /** The model's one-tap offer on its own refusal: an instruction the teacher can send. */
      offer?: string | undefined;
    };

export interface EditFastDeps {
  ai: CreatedAi;
  logger: Logger;
  signal?: AbortSignal | undefined;
  context?: PipelineContext | undefined;
  /**
   * Stream the answer as it is written (TEACH-97): each call is streamed and its partial answer
   * handed here, for display only. Nothing in a partial has been checked; the result returned at
   * the end is the only thing to apply. A retry round starts again from an empty partial.
   */
  onPartial?: ((partial: EditFastPartial) => void) | undefined;
  /**
   * The budget to spend from (a host's allowance, e.g. a workspace's). Absent: a fresh per-edit
   * budget. Either way every call goes through the reservation middleware, streamed or not.
   */
  budget?: Budget | undefined;
}

/** A partial answer for display: the summary so far and each text box's new text so far. */
export type EditFastPartial = { summary: string; texts: { elementId: string; text: string }[] };

/** The display partial of a raw streamed answer; null while it is not (yet) an edit. */
export function editFastPartial(raw: unknown): EditFastPartial | null {
  if (typeof raw !== "object" || raw === null) return null;
  const out = raw as { action?: unknown; summary?: unknown; changes?: unknown };
  if (out.action !== undefined && out.action !== "edit") return null;
  const texts: EditFastPartial["texts"] = [];
  if (Array.isArray(out.changes))
    for (const c of out.changes as { target?: unknown; text?: unknown }[]) {
      const m = typeof c?.target === "string" ? ELEMENT_TEXT.exec(c.target) : null;
      if (m?.[2] && typeof c.text === "string") texts.push({ elementId: m[2], text: c.text });
    }
  return { summary: typeof out.summary === "string" ? out.summary : "", texts };
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
    ...(req.history && req.history.length > 0 ? { history: req.history.slice(-3) } : {}),
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
  const budget = deps.budget ?? createBudget(EDIT_FAST_BUDGET);
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
      // Every key of the schema is required (nullable), so strict mode accepts it: off-schema
      // answers (`type` for `action`) are refused by the provider rather than retried here.
      strict: true,
      onPartial: deps.onPartial
        ? (raw: unknown) => {
            const partial = editFastPartial(raw);
            if (partial) deps.onPartial?.(partial);
          }
        : undefined,
    });

  let attempts = 0;
  let retry: EditFastInput["retry"];
  // Every check that failed, over both rounds: the refusal names the most telling one, so a fit
  // fault in round 1 is still "won't fit" when the retry then fails on shape or scope.
  const seen = new Set<FailedCheck>();
  // The direction the edit must move the text: the instruction's own, or, for a bare follow-up
  // ("a bit more"), the last measurable instruction in the thread (TEACH-97 item 4).
  const direction = directionOf(req.instruction, req.history);
  for (let round = 0; round < 2; round++) {
    let result: Awaited<ReturnType<typeof call>>;
    try {
      result = await call(retry);
    } catch (error) {
      // A retry that fails to answer in shape keeps the first round's verdict; an abort, a
      // budget stop or a first-round failure is the route's error, as before.
      if (round === 0 || seen.size === 0 || signal.aborted || !(error instanceof StageFailure))
        throw error;
      seen.add("shape");
      break;
    }
    attempts += result.attempts;
    const out = result.output;
    if (out.action === "refuse")
      return {
        action: "refuse",
        reason: out.reason?.trim() || EDIT_MESSAGES.failed,
        attempts,
        ms: ms(),
        check: "model",
        ...(out.offer?.trim() ? { offer: out.offer.trim().slice(0, EDIT_INSTRUCTION_MAX) } : {}),
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
      seen.add(applied.fault.startsWith("scope") ? "scope" : "shape");
    } else {
      if (applied.changes.length === 0)
        return { action: "no-change", reason: EDIT_MESSAGES.noChange, attempts, ms: ms() };
      faults = [];
      for (const c of applied.changes) {
        const at = targetOf(input.slidePath, c.elementId);
        if (c.text.trim() === "") {
          faults.push(`${at}: the text is empty`);
          seen.add("shape");
          continue;
        }
        const leak = leakFaults(req.slide, applied.slide, c.elementId);
        const fit = fitFaults(req.slide, applied.slide, c.elementId, req.lesson.themeId);
        if (leak.length > 0) seen.add("leak");
        if (fit.length > 0) seen.add("fit");
        faults.push(...[...leak, ...fit].map((f) => `${at}: ${f}`));
      }
      if (faults.length === 0 && direction) {
        const fault = directionFault(
          direction,
          applied.changes
            .map((c) =>
              textOfElement(req.slide.elements.find((e) => e.id === c.elementId) as SlideElement),
            )
            .join("\n"),
          applied.changes.map((c) => c.text).join("\n"),
        );
        if (fault) {
          faults.push(`${input.target}: ${fault}`);
          seen.add("direction");
        }
      }
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
  const check = refusalCheck(seen);
  return { action: "refuse", reason: refusalReason(check, direction), attempts, ms: ms(), check };
}

type FailedCheck = "fit" | "leak" | "scope" | "shape" | "direction";

/** The check a refusal names: a leak first, then fit, then direction, else a shape miss. */
export function refusalCheck(seen: ReadonlySet<FailedCheck>): FailedCheck {
  for (const c of ["leak", "fit", "direction", "scope"] as const) if (seen.has(c)) return c;
  return "shape";
}

/** The teacher's words for a code refusal. */
export function refusalReason(check: FailedCheck, direction?: EditDirection): string {
  if (check === "leak") return EDIT_MESSAGES.leaksAnswer;
  if (check === "fit") return EDIT_MESSAGES.wontFit;
  if (check === "direction" && direction) return directionMessage(direction);
  return EDIT_MESSAGES.failed;
}

/* ------------------------------------------------------------------ */
/* Direction: follow-ups keep the last edit's way (TEACH-97 item 4)   */
/* ------------------------------------------------------------------ */

export type EditDirection = "shorter" | "simpler" | "harder" | "easier";

/** A bare follow-up that repeats the last edit's direction. */
const FOLLOW_UP =
  /^\s*(a bit more|a little more|bit more|more|even more|a bit|a little|again|same again|keep going|further)\b[\s.!]*$/i;

function ownDirection(instruction: string): EditDirection | undefined {
  const i = instruction.toLowerCase();
  if (/\b(shorten|shorter|trim|cut it)\b/.test(i)) return "shorter";
  if (/\b(simplif|simpler|easier to read|plainer|weaker readers)/.test(i)) return "simpler";
  if (/\b(harder|more challenging|top set|stretch them)\b/.test(i)) return "harder";
  if (/\b(easier|less hard)\b/.test(i)) return "easier";
  return undefined;
}

/**
 * The direction an edit must move the text (research `chain.ts` `directionOf`): the instruction's
 * own, or for a bare follow-up the latest measurable instruction in the thread.
 */
export function directionOf(
  instruction: string,
  history?: EditFastRequest["history"],
): EditDirection | undefined {
  const own = ownDirection(instruction);
  if (own || !FOLLOW_UP.test(instruction)) return own;
  for (const turn of [...(history ?? [])].reverse()) {
    const d = ownDirection(turn.instruction);
    if (d) return d;
    if (!FOLLOW_UP.test(turn.instruction)) return undefined;
  }
  return undefined;
}

const numbersIn = (t: string) => (t.match(/\d+/g) ?? []).map(Number);
function readability(t: string) {
  const w = t.split(/\s+/).filter(Boolean);
  const sentences = t.split(/[.!?\n]+/).filter((x) => x.trim()).length || 1;
  return {
    words: w.length,
    perSentence: w.length / sentences,
    long: w.filter((x) => x.replace(/\W/g, "").length > 8).length,
  };
}

/**
 * Did the edit move the text the asked-for way (research `directionFault`)? Judged only where it
 * is measurable: length for shorter, words for simpler, the largest number for harder or easier
 * when both versions have numbers. The fault is written for the model's retry.
 */
export function directionFault(
  dir: EditDirection,
  before: string,
  after: string,
): string | undefined {
  if (dir === "shorter" && after.length >= before.length)
    return `the change did not make it shorter (${before.length} -> ${after.length} characters); make it shorter than it is now`;
  if (dir === "simpler") {
    const a = readability(before);
    const b = readability(after);
    if (!(b.words < a.words || b.perSentence < a.perSentence || b.long < a.long))
      return `the change did not make it simpler (words ${a.words} -> ${b.words}, long words ${a.long} -> ${b.long}); use fewer or shorter words than it has now`;
  }
  const na = numbersIn(before);
  const nb = numbersIn(after);
  if ((dir === "harder" || dir === "easier") && na.length > 0 && nb.length > 0) {
    const ma = Math.max(...na);
    const mb = Math.max(...nb);
    if (dir === "harder" && mb <= ma)
      return `the numbers did not get harder (largest ${ma} -> ${mb}); make them harder than they are now`;
    if (dir === "easier" && mb >= ma)
      return `the numbers did not get easier (largest ${ma} -> ${mb}); make them easier than they are now`;
  }
  return undefined;
}
