import type { Lesson } from "@tj/domain/documents";
import type { PendingSlide } from "@tj/editor/present";

/**
 * The slides a generating lesson has still to receive, from the document alone (ADR 0025 §7).
 * Plan persists `facts.outline` with the objectives slide, before any content slide, and Generate
 * appends exactly one slide per outline entry in order — so the entries past `slides.length` are
 * what is still to come. Before `facts` exists only the title slide has landed, and the one
 * certainty is that an objectives slide follows it. Anything else (no facts and 0 or 2+ slides,
 * a failed Plan) promises nothing.
 */
export function pendingSlides(lesson: Lesson): PendingSlide[] {
  if (lesson.facts) {
    return lesson.facts.outline.slice(lesson.slides.length).map(({ kind }) => ({ kind }));
  }
  return lesson.slides.length === 1 ? [{ kind: "objectives" }] : [];
}
