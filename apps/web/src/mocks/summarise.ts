import type { Lesson, Slide, Worksheet } from "@tj/domain/documents";
import type { DocumentSummary } from "./library-schema";

/**
 * Structural kind check. Deliberately not the Zod `isLesson`: this module sits on the library's
 * initial path and the document schemas would ride along with it (ADR 0022 §8); bodies in the
 * store were validated when they entered it.
 */
export const isLessonBody = (body: Lesson | Worksheet): body is Lesson => "slides" in body;

/** What the mock store keeps per document: the editor document plus the soft-delete flag. */
export type StoredDocument = {
  body: Lesson | Worksheet;
  deletedAt?: string;
};

/**
 * The first slide as the library card paints it. Data-URL images are stripped to an empty `src`
 * so a list response never carries megabytes of base64 (ADR 0021 §5); the renderer shows the
 * image frame without a picture. `loadDocument` still returns the full body.
 */
export function coverOf(lesson: Lesson): Slide | null {
  const first = lesson.slides[0];
  if (!first) return null;
  // A deep copy: a summary leaves the store through the list and series queries, and a caller
  // mutating a nested element must never reach the stored document.
  const cover = structuredClone(first);
  for (const element of cover.elements) {
    if (element.type === "image" && element.src.startsWith("data:")) element.src = "";
  }
  return cover;
}

/**
 * The web-local library summary, derived from the stored document (ADR 0021 §6). One definition:
 * every list, detail placeholder and series sheet reads the same fields the same way, and the
 * API decides its own list shape later.
 */
export function summarise({ body, deletedAt }: StoredDocument): DocumentSummary {
  const base = {
    id: body.id,
    title: body.title,
    themeId: body.themeId,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
    ...(body.subject ? { subject: body.subject } : {}),
    ...(body.yearGroup ? { yearGroup: body.yearGroup } : {}),
    ...(deletedAt ? { deletedAt } : {}),
  };
  if (isLessonBody(body)) {
    return { ...base, kind: "lesson", count: body.slides.length, cover: coverOf(body) };
  }
  return { ...base, kind: "worksheet", count: body.blocks.length, cover: null };
}
