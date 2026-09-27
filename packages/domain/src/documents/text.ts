import { type RichDoc, richDocToPlainText } from "./rich-text";
import type { Slide, SlideElement } from "./slide";
import type { Worksheet } from "./worksheet";

/*
 * The plain-text projection of a slide and of a worksheet block (ADR 0025 §11): what Evaluate,
 * Repair and the eval judge read, and what the deterministic checks measure. Lives in `@tj/domain`
 * so `checkLesson` can use it; `@tj/generation` re-exports it.
 */

/** Visit every element on a slide, descending into groups. */
export function walkElements(
  elements: readonly SlideElement[],
  visit: (element: SlideElement) => void,
): void {
  for (const element of elements) {
    visit(element);
    if (element.type === "group") walkElements(element.children, visit);
  }
}

/** Every doc on a slide, groups included, as one text with a line per element. */
export function slideText(slide: Slide): string {
  const lines: string[] = [];
  walkElements(slide.elements, (element) => {
    if (element.type === "group") return;
    if ("doc" in element && element.doc) {
      const text = richDocToPlainText(element.doc as RichDoc).trim();
      if (text) lines.push(text);
    }
    if (element.type === "table") lines.push(element.rows.map((r) => r.join(" | ")).join("\n"));
  });
  const q = slide.question;
  if (q?.type === "true-false") lines.push(`Answer: ${q.correct ? "True" : "False"}`);
  if (q?.type === "fill-gap") lines.push(`Answers: ${q.gaps.map((g) => g.answer).join(", ")}`);
  if (q?.type === "open-response" && q.modelAnswer) lines.push(`Model answer: ${q.modelAnswer}`);
  if (q?.type === "multiple-choice") {
    const correct = new Set(q.options.filter((o) => o.correct).map((o) => o.id));
    const labels = slide.elements
      .filter((e) => e.type === "option" && correct.has(e.id))
      .map((e) => richDocToPlainText((e as { doc: RichDoc }).doc));
    if (labels.length > 0) lines.push(`Correct: ${labels.join(", ")}`);
  }
  return lines.join("\n");
}

export function blockText(block: Worksheet["blocks"][number]): string {
  const lines: string[] = [];
  if ("doc" in block && block.doc) lines.push(richDocToPlainText(block.doc));
  switch (block.type) {
    case "question":
      if (block.answer) lines.push(`Answer: ${block.answer}`);
      break;
    case "multiple-choice":
      lines.push(block.options.map((o) => `${o.correct ? "[x]" : "[ ]"} ${o.text}`).join(" · "));
      break;
    case "fill-gap":
      lines.push(`Answers: ${block.gaps.map((g) => g.answer).join(", ")}`);
      break;
    case "matching":
      lines.push(block.pairs.map((p) => `${p.left} → ${p.right}`).join("; "));
      break;
    case "word-bank":
    case "word-search":
      lines.push(block.words.join(", "));
      break;
    case "table":
      lines.push(block.rows.map((r) => r.join(" | ")).join("\n"));
      break;
    default:
      break;
  }
  return lines.join("\n");
}
