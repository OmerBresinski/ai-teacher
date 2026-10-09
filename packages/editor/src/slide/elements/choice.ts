/**
 * Choice answers drawn as cards or boxes (TEACH-101 part b): the words that name one, and which
 * ones the reveal marks. Kept out of `kit.ts` so print chunks that never show a choice stay small.
 */
import type { Slide, SlideElement } from "@tj/domain/documents";
import { richDocToPlainText as docToPlainText } from "@tj/domain/documents";

/**
 * The words that name a choice or answer element: its own text, or, for a card or option box drawn
 * as a shape (the template hinge, choose and odd-one-out cards), the text elements inside it.
 */
export function choiceText(slide: Slide, id: string): string {
  const el = slide.elements.find((e) => e.id === id);
  if (!el) return "";
  // A card's marker disc is named after its card ("Marker: frog"): quote the card's word.
  if (el.type === "shape" && el.name?.startsWith("Marker: ")) return el.name.slice(8).trim();
  const own = "doc" in el && el.doc ? docToPlainText(el.doc).trim() : "";
  if (own) return own;
  // A card's picture (a sequence's order) is named by its alt text, which is the card's word.
  if (el.type === "image") return el.alt?.trim() ?? "";
  const inside = (e: SlideElement) => {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    return cx > el.x && cx < el.x + el.w && cy > el.y && cy < el.y + el.h;
  };
  return slide.elements
    .filter((e) => e.id !== id && (e.type === "text" || e.type === "gap-text") && inside(e))
    .map((e) => ("doc" in e && e.doc ? docToPlainText(e.doc).trim() : ""))
    .filter(Boolean)
    .join(" ");
}

/**
 * A choice question whose options are not `option` elements (cards and option boxes): the ids
 * the reveal marks, each dimmed in turn when wrong and ringed with a tick when right.
 */
export function choiceMarks(
  slide: Slide,
  revealAnswer: boolean,
  answerProgress: number,
): { id: string; state: "dim" | "right" }[] {
  const q = slide.question;
  if (q?.type !== "multiple-choice") return [];
  const wrong = q.options.filter((o) => !o.correct);
  return q.options.flatMap((o): { id: string; state: "dim" | "right" }[] => {
    const el = slide.elements.find((e) => e.id === o.id);
    if (!el || el.type === "option") return [];
    if (o.correct) return revealAnswer ? [{ id: o.id, state: "right" as const }] : [];
    const rank = wrong.findIndex((w) => w.id === o.id);
    return revealAnswer || answerProgress > rank ? [{ id: o.id, state: "dim" as const }] : [];
  });
}
