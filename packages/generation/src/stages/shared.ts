import type {
  Finding,
  Lesson,
  RichDoc,
  Slide,
  SlideElement,
  Worksheet,
} from "@tj/domain/documents";
import { richDocToPlainText } from "@tj/domain/documents";
import type { Audience } from "../prompts";

/*
 * Small pure helpers the stages share: the audience block from a lesson, the plain-text
 * projection of slides and blocks (what Evaluate and Repair read, ADR 0025 §11), and the
 * generation-state accessor, and the finding a budget stop records (§15).
 */

/** The residual a stage records when the per-lesson budget stops it between calls (ADR 0025 §15). */
export const BUDGET_FINDING = (by: "usd" | "tokens", where: string): Finding => ({
  check: "budget",
  severity: "error",
  target: {},
  message: `Generation stopped at ${where}: the lesson's ${by === "usd" ? "cost" : "token"} cap was reached. What was written is kept.`,
});

export function audienceOf(lesson: Lesson): Audience {
  return {
    subject: lesson.subject,
    yearGroup: lesson.yearGroup,
    ageBand: lesson.ageBand,
    readingLevel: lesson.readingLevel,
    language: lesson.language,
    classContext: lesson.brief?.classContext,
  };
}

/** Every doc on a slide, groups included, as one text with a line per element. */
export function slideText(slide: Slide): string {
  const lines: string[] = [];
  const walk = (elements: SlideElement[]) => {
    for (const element of elements) {
      if (element.type === "group") {
        walk(element.children);
        continue;
      }
      if ("doc" in element && element.doc) {
        const text = richDocToPlainText(element.doc as RichDoc).trim();
        if (text) lines.push(text);
      }
      if (element.type === "table") lines.push(element.rows.map((r) => r.join(" | ")).join("\n"));
    }
  };
  walk(slide.elements);
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

/** The generation record a later stage extends; Plan writes it, so it is present from then on. */
export function generationOf(lesson: Lesson): NonNullable<Lesson["generation"]> {
  if (!lesson.generation) throw new Error("lesson has no generation state; Plan has not run");
  return lesson.generation;
}
