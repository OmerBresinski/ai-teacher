import type { Finding, Lesson, OutlineEntry, Slide } from "@tj/domain/documents";
import { type ImageTextPhoto, PLACEHOLDER_IMAGE } from "@tj/slides";
import type { Audience, SlidePhoto } from "../prompts";

// The plain-text projections moved to `@tj/domain/documents/text` so `checkLesson` can measure the
// same text Evaluate reads (TEACH-210); re-exported so the stages' import paths stand.
export { blockText, slideText } from "@tj/domain/documents";

/*
 * Small pure helpers the stages share: the audience block from a lesson, the plain-text
 * projection of slides and blocks (what Evaluate and Repair read, ADR 0025 §11 — now in
 * `@tj/domain`), the generation-state accessor, and the finding a budget stop records (§15).
 */

/** The residual a stage records when the per-lesson budget stops it between calls (ADR 0025 §15). */
export const BUDGET_FINDING = (by: "usd" | "tokens", where: string): Finding => ({
  check: "budget",
  severity: "error",
  target: {},
  message: `Generation stopped at ${where}: the lesson's ${by === "usd" ? "cost" : "token"} cap was reached. What was written is kept.`,
});

/**
 * What an existing `image-text` slide's text may rely on (TEACH-220): the evidence the photo judge
 * left on its image element, or `"none"` when the slot is still the placeholder or was placed
 * before the judge recorded evidence (then the text may set no picture task at all).
 */
export function imageTextPhotoOf(
  slide: Slide,
  entry: OutlineEntry | undefined,
): ImageTextPhoto | "none" {
  const image = slide.elements.find((e) => e.type === "image");
  if (image?.type !== "image" || image.src === PLACEHOLDER_IMAGE) return "none";
  const evidence = image.source?.evidence;
  if (!evidence) return "none";
  return {
    visible: evidence.visible,
    count: evidence.count,
    mustShow: entry?.imageBrief?.mustShow ?? [],
  };
}

/** The same evidence in the prompt's shape (what the photograph shows and does not). */
export function slidePhotoOf(slide: Slide, entry: OutlineEntry | undefined): SlidePhoto | "none" {
  const photo = imageTextPhotoOf(slide, entry);
  if (photo === "none") return "none";
  const image = slide.elements.find((e) => e.type === "image");
  const evidence = image?.type === "image" ? image.source?.evidence : undefined;
  const seen = new Set(photo.visible.map((v) => v.trim().toLowerCase()));
  return {
    alt: evidence?.alt ?? "",
    visible: photo.visible,
    notVisible: photo.mustShow.filter((m) => !seen.has(m.trim().toLowerCase())),
    count: photo.count,
    purpose: entry?.imageBrief?.purpose ?? "context",
  };
}

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

/** The generation record a later stage extends; Plan writes it, so it is present from then on. */
export function generationOf(lesson: Lesson): NonNullable<Lesson["generation"]> {
  if (!lesson.generation) throw new Error("lesson has no generation state; Plan has not run");
  return lesson.generation;
}

/**
 * Run `items` through `fn` with at most `limit` in flight; rejects on the first thrown error.
 * Shared by the proposal jobs and Generate (TEACH-213).
 */
export async function runBounded<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  });
  // Every worker settles before the first error propagates, so a caller never sees a rejection
  // while other items are still in flight.
  const settled = await Promise.allSettled(workers);
  const rejected = settled.find((r) => r.status === "rejected");
  if (rejected) throw rejected.reason;
}
