import { type RichDoc, type RichNode, richDocToPlainText } from "./rich-text";
import { SET_LINES_MAX, type SetAnswer, type Slide, setAnswersElement } from "./slide";

/*
 * TEACH-101: a coded question set's answers box is the single source of truth for its answers.
 * The box is either the strip under the list ("Answers: 1 … · 2 …", one paragraph) or the answers
 * card (one paragraph per answer, its number in a run of its own). Readers (the drawer, the
 * exports) read the answers from the box, so a teacher's edit on the canvas is never stale; the
 * question's `items` are the generator's copy, kept in step by the drawer and used only when the
 * box is gone. The drawer edits one answer's characters in place, so every other line, paragraph
 * and mark the teacher gave the box stays.
 */

const STRIP = /^\s*Answers:/;
const NUMBERED = /^(\d+)\.?\s+/;
const SEP = "·";

/** Where one answer sits in the box: paragraph, character range in that paragraph's text runs. */
export type AnswerSpan = SetAnswer & { paragraph: number; start: number; end: number };

/** A paragraph's text as its text runs spell it (other inline nodes count as nothing). */
const runsText = (para: RichNode): string =>
  (para.content ?? []).map((n) => (n.type === "text" ? (n.text ?? "") : "")).join("");

/** Whether the box is the one-line strip rather than the card. */
export function isAnswersStrip(doc: RichDoc): boolean {
  const paras = doc.content ?? [];
  return paras.length === 1 && STRIP.test(runsText(paras[0] as RichNode));
}

/** One "2 Boudica" part at `offset` in its paragraph, trimmed, as a span. */
function span(text: string, offset: number, paragraph: number, fallback: number): AnswerSpan {
  const lead = text.length - text.trimStart().length;
  const body = text.trim();
  const m = NUMBERED.exec(body);
  const skip = m ? m[0].length : 0;
  const start = offset + lead + skip;
  const answer = body.slice(skip);
  return {
    paragraph,
    start,
    end: start + answer.length,
    lineIndex: m ? Number(m[1]) - 1 : fallback,
    answer,
  };
}

/** Every answer the box lists, in order, with where it sits. */
export function answerSpans(doc: RichDoc): AnswerSpan[] {
  const paras = doc.content ?? [];
  if (isAnswersStrip(doc)) {
    const text = runsText(paras[0] as RichNode);
    const head = (STRIP.exec(text) as RegExpExecArray)[0].length;
    const out: AnswerSpan[] = [];
    let at = head;
    for (const part of text.slice(head).split(SEP)) {
      if (part.trim()) out.push(span(part, at, 0, out.length));
      at += part.length + SEP.length;
    }
    return out;
  }
  const out: AnswerSpan[] = [];
  paras.forEach((p, i) => {
    const text = runsText(p);
    if (text.trim()) out.push(span(text, 0, i, out.length));
  });
  return out;
}

/** The numbered answers a box lists, in order. */
export function answersInBox(doc: RichDoc): SetAnswer[] {
  return answerSpans(doc).map(({ lineIndex, answer }) => ({ lineIndex, answer }));
}

/**
 * The paragraph with characters `start`–`end` of its text runs replaced by `text`, in the marks of
 * the run the range starts in; every other run is left as it was.
 */
function splice(para: RichNode, start: number, end: number, text: string): RichNode {
  const out: RichNode[] = [];
  let at = 0;
  let placed = false;
  const place = (marks?: RichNode["marks"]) => {
    if (placed) return;
    placed = true;
    if (text) out.push({ type: "text", text, ...(marks?.length ? { marks } : {}) });
  };
  for (const node of para.content ?? []) {
    if (node.type !== "text") {
      if (at >= start) place();
      out.push(node);
      continue;
    }
    const value = node.text ?? "";
    const from = at;
    const to = at + value.length;
    at = to;
    const keep = (s: string) => {
      if (s) out.push({ ...node, text: s });
    };
    // Wholly before the range; a run ending exactly at `start` (the card's number) keeps its
    // text and the answer takes the next run's marks.
    if (to <= start) {
      keep(value);
      continue;
    }
    keep(value.slice(0, Math.max(0, start - from)));
    place(node.marks);
    keep(value.slice(Math.max(0, end - from)));
  }
  place();
  return { ...para, content: merged(out) };
}

/** Adjacent text runs with the same marks joined, as the editor would store them. */
function merged(nodes: RichNode[]): RichNode[] {
  const out: RichNode[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (
      last?.type === "text" &&
      node.type === "text" &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      out[out.length - 1] = { ...last, text: `${last.text ?? ""}${node.text ?? ""}` };
    } else out.push(node);
  }
  return out;
}

/**
 * The box's doc with the answer at `position` (its order in `answerSpans`) set to `answer`. Only
 * that answer's characters change. A position past the end returns the doc unchanged.
 */
export function withSetAnswer(doc: RichDoc, position: number, answer: string): RichDoc {
  const s = answerSpans(doc)[position];
  const paras = doc.content ?? [];
  const para = s ? paras[s.paragraph] : undefined;
  if (!s || !para) return doc;
  return {
    ...doc,
    content: paras.map((p, i) => (i === s.paragraph ? splice(para, s.start, s.end, answer) : p)),
  };
}

/** A set slide's answers: read from its box (the source of truth), else the question's copy. */
export function setAnswersOf(slide: Slide): SetAnswer[] {
  const q = slide.question;
  if (q?.type !== "set") return [];
  const box = setAnswersElement(slide);
  return box && "doc" in box && box.doc ? answersInBox(box.doc) : q.items;
}

/** The plain text of a box (for tests and labels). */
export const answersBoxText = (doc: RichDoc): string => richDocToPlainText(doc);

/** The slide without its set question when the answers box it names is no longer on it. */
export function withoutOrphanSet(slide: Slide): Slide {
  if (slide.question?.type !== "set" || setAnswersElement(slide)) return slide;
  const { question: _gone, ...rest } = slide;
  return rest;
}

/**
 * The question's copy of a box's answers, valid for the schema whatever the teacher typed: each
 * line number after the one before it, none past `SET_LINES_MAX`.
 */
export function setItemsFromBox(doc: RichDoc): SetAnswer[] {
  const out: SetAnswer[] = [];
  for (const { answer, lineIndex } of answersInBox(doc)) {
    const before = out[out.length - 1];
    const at = before ? Math.max(before.lineIndex + 1, lineIndex) : lineIndex;
    if (at >= SET_LINES_MAX) break;
    out.push({ answer, lineIndex: at });
  }
  return out;
}
