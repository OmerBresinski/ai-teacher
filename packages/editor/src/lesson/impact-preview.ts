import type { ProposalTarget } from "@tj/domain";
import type { Id, Lesson, SlideElement } from "@tj/domain/documents";

/*
 * The regenerate dialog's "Also changes:" line (ADR 0025 §18): the other AI-authored elements
 * that share a fact with the target, by slide, computed client-side from `generatedFrom.factRefs`
 * — no model call. Informational: a wording-only regenerate runs no cascade, so this is what a
 * later fact edit *would* touch, shown so the teacher knows what else leans on the same facts.
 */

export interface ImpactPreview {
  /** The facts the target is derived from; empty when it has no provenance. */
  factRefs: string[];
  /** Other slides (document order, 1-based numbers) holding AI elements that share a fact. */
  slides: { slideId: Id; number: number }[];
}

const walk = (elements: readonly SlideElement[], visit: (element: SlideElement) => void) => {
  for (const element of elements) {
    if (element.type === "group") walk(element.children, visit);
    else visit(element);
  }
};

export function impactPreview(lesson: Lesson, target: ProposalTarget): ImpactPreview {
  const slide = lesson.slides.find((s) => s.id === target.slideId);
  if (!slide) return { factRefs: [], slides: [] };
  const refs = new Set<string>();
  walk(slide.elements, (element) => {
    if (target.elementId !== undefined && element.id !== target.elementId) return;
    for (const ref of element.generatedFrom?.factRefs ?? []) refs.add(ref);
  });
  if (refs.size === 0) return { factRefs: [], slides: [] };
  const slides: ImpactPreview["slides"] = [];
  lesson.slides.forEach((other, index) => {
    if (other.id === slide.id) return;
    let shares = false;
    walk(other.elements, (element) => {
      if (shares || element.authoredBy !== "ai") return;
      if (element.generatedFrom?.factRefs.some((ref) => refs.has(ref))) shares = true;
    });
    if (shares) slides.push({ slideId: other.id, number: index + 1 });
  });
  return { factRefs: [...refs], slides };
}

/** "Also changes: slides 4, 7" / "Also changes: slide 7" / "Also changes: —". */
export function impactSentence(preview: ImpactPreview): string {
  if (preview.slides.length === 0) return "Also changes: —";
  const numbers = preview.slides.map((s) => s.number).join(", ");
  return `Also changes: ${preview.slides.length === 1 ? "slide" : "slides"} ${numbers}`;
}

/**
 * The slides a cascade for `factIds` will touch: those with an AI-authored element deriving from
 * any of them (the worker's `impactSet`, slide half, without the cap). For the busy overlay while
 * the job runs; the applied proposals are the truth afterwards.
 */
export function slidesReferencing(lesson: Lesson, factIds: readonly string[]): Id[] {
  const changed = new Set(factIds);
  const out: Id[] = [];
  for (const slide of lesson.slides) {
    let hit = false;
    walk(slide.elements, (element) => {
      if (hit || element.authoredBy !== "ai") return;
      if (element.generatedFrom?.factRefs.some((ref) => changed.has(ref))) hit = true;
    });
    if (hit) out.push(slide.id);
  }
  return out;
}
