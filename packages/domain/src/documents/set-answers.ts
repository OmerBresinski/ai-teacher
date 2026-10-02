import { type RichDoc, type RichNode, richDocToPlainText } from "./rich-text";
import type { SetAnswer } from "./slide";

/*
 * TEACH-101: a coded question set's answers box, kept in step with its `set` question. The box is
 * either the strip under the list ("Answers: 1 … · 2 …", one paragraph) or the answers card (one
 * paragraph per answer, its number in a run of its own). Editing an answer rewrites the box's
 * words and keeps its look: the number run's marks and the answer run's marks stay.
 */

const STRIP = /^Answers:/;
const NUMBER = /^\s*\d+\s*$/;
const SEP = "  ·  ";

/** Whether the box is the one-line strip rather than the card. */
export function isAnswersStrip(doc: RichDoc): boolean {
  const paras = doc.content ?? [];
  return paras.length === 1 && STRIP.test(richDocToPlainText(paras[0] as RichNode).trim());
}

const textNode = (text: string, marks?: RichNode["marks"]): RichNode[] =>
  text ? [{ type: "text", text, ...(marks?.length ? { marks } : {}) }] : [];

/** The answers box's doc with `items` written into it. */
export function withSetAnswers(doc: RichDoc, items: readonly SetAnswer[]): RichDoc {
  const paras = doc.content ?? [];
  if (isAnswersStrip(doc)) {
    const para = paras[0] as RichNode;
    const marks = para.content?.find((n) => n.type === "text")?.marks;
    const text = `Answers: ${items.map((a) => `${a.lineIndex + 1} ${a.answer}`).join(SEP)}`;
    return { ...doc, content: [{ ...para, content: textNode(text, marks) }] };
  }
  return {
    ...doc,
    content: items.map((item, i) => {
      const para: RichNode = paras[i] ?? { type: "paragraph" };
      const runs = para.content ?? [];
      const head = runs[0];
      const numbered = head?.type === "text" && NUMBER.test(head.text ?? "");
      const number = numbered ? head : { type: "text", text: `${item.lineIndex + 1} ` };
      const answerMarks = runs[numbered ? 1 : 0]?.marks;
      return { ...para, content: [number, ...textNode(item.answer, answerMarks)] };
    }),
  };
}

/**
 * The numbered answers a box lists, in order: the card's paragraphs ("2 Boudica"), or the strip's
 * entries ("Answers: 1 … · 2 …"). A paragraph with no number takes the next line's.
 */
export function answersInBox(doc: RichDoc): SetAnswer[] {
  if (isAnswersStrip(doc)) {
    const text = richDocToPlainText(doc).trim().replace(STRIP, "").trim();
    return text
      .split(SEP.trim())
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part, i) => numbered(part, i));
  }
  return (doc.content ?? [])
    .map((p) => richDocToPlainText(p).trim())
    .filter(Boolean)
    .map((part, i) => numbered(part, i));
}

function numbered(part: string, i: number): SetAnswer {
  const m = /^(\d+)\.?\s+(.*)$/s.exec(part);
  return m
    ? { lineIndex: Number(m[1]) - 1, answer: (m[2] ?? "").trim() }
    : { lineIndex: i, answer: part };
}
