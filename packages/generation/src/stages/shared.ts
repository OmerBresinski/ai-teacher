import {
  type Finding,
  isTrustedThumbnail,
  type Lesson,
  type OutlineEntry,
  richDocToPlainText,
  type Slide,
} from "@tj/domain/documents";
import { type ImageTextPhoto, PLACEHOLDER_IMAGE } from "@tj/slides";
import type { Audience, SlidePhoto } from "../prompts";

// The plain-text projections moved to `@tj/domain/documents/text` so `checkLesson` can measure the
// same text Evaluate reads (TEACH-210); re-exported so the stages' import paths stand.
export { blockText, slideText } from "@tj/domain/documents";

import { slideText } from "@tj/domain/documents";

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

/**
 * The photographs a reviewer may be shown (TEACH-220): each placed `image-text` slide's thumbnail
 * — the picture the pick judge looked at — keyed by slide id, in slide order. Only a trusted
 * thumbnail (the provider's CDN or an inline data URL) is handed on: the model SDK fetches it from
 * the worker, so the check is repeated here for documents written before the schema had it.
 */
export function photoThumbnails(lesson: Lesson): { id: string; url: string }[] {
  const out: { id: string; url: string }[] = [];
  for (const slide of lesson.slides) {
    if (slide.kind !== "image-text") continue;
    const image = slide.elements.find((e) => e.type === "image");
    const url = image?.type === "image" ? image.source?.evidence?.thumbnail : undefined;
    if (url && isTrustedThumbnail(url)) out.push({ id: slide.id, url });
  }
  return out;
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

/** Text compared case- and whitespace-insensitively, as Evaluate quotes it. */
export const normaliseText = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** What a slide finding may quote: the slide's text and its notes. */
export const slideHaystack = (slide: Slide) =>
  normaliseText(`${slideText(slide)}\n${slide.notes ?? ""}`);

/**
 * The slide's text as labelled spec fields (TEACH-222): `heading`, `body`, `option A (correct)`,
 * `notes` — never the recipe's fixed captions (`KEY IDEA`, `QUESTION`, `WORKING`), which the model
 * would otherwise copy into `heading`. The label is the element's text preset, which is what the
 * generate prompt's shape names; `small` is the pupils' instruction line.
 */
export function specFieldsOf(slide: Slide): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  const correct = new Set(
    slide.question?.type === "multiple-choice"
      ? slide.question.options.filter((o) => o.correct).map((o) => o.id)
      : [],
  );
  for (const element of slide.elements) {
    if (element.type === "text") {
      const preset = element.style?.preset;
      if (preset === "caption") continue;
      const text = richDocToPlainText(element.doc).trim();
      if (text) out.push({ field: preset === "small" ? "instruction" : (preset ?? "text"), text });
    } else if (element.type === "option") {
      const text = richDocToPlainText(element.doc).trim();
      out.push({
        field: `option ${element.label}${correct.has(element.id) ? " (correct)" : ""}`,
        text,
      });
    } else if (element.type === "table") {
      out.push({ field: "table", text: element.rows.map((r) => r.join(" | ")).join("\n") });
    }
  }
  const q = slide.question;
  if (q?.type === "true-false") out.push({ field: "correct", text: q.correct ? "True" : "False" });
  if (q?.type === "open-response" && q.modelAnswer) {
    out.push({ field: "modelAnswer", text: q.modelAnswer });
  }
  if (q?.type === "fill-gap")
    out.push({ field: "answers", text: q.gaps.map((g) => g.answer).join(", ") });
  if (slide.notes) out.push({ field: "notes", text: slide.notes });
  return out;
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
