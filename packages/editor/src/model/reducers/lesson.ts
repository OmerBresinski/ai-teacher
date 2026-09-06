/** Lesson-level reducers: title, theme, metadata, fit-version bookkeeping. */

import type { Lesson } from "@tj/domain/documents";
import { edit, editQuietly, silent } from "./core";

export const setTitle = (lesson: Lesson, title: string): Lesson =>
  edit(lesson, (l) => {
    l.title = title;
  });

export const setTheme = (lesson: Lesson, themeId: string): Lesson =>
  edit(lesson, (l) => {
    l.themeId = themeId;
  });

export type LessonMetaPatch = Partial<
  Pick<Lesson, "subject" | "ageBand" | "yearGroup" | "readingLevel" | "language">
>;

/**
 * Lesson metadata in one undo step. A key set to undefined or '' is removed, so clearing a field
 * leaves the document as if it had never been set.
 */
export const setLessonMeta = (lesson: Lesson, patch: LessonMetaPatch): Lesson =>
  edit(lesson, (l) => {
    const doc = l as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === "") delete doc[key];
      else doc[key] = value;
    }
  });

/**
 * Record the projector-floor table the slides are now fitted to (`FIT_VERSION`). Written by the
 * fit migration and by nothing else. Bookkeeping, not an edit: no undo entry and no `updatedAt`,
 * so undoing the migration returns the layout the teacher arrived with and leaves the stamp in
 * place — otherwise the migration would run again on every open.
 */
export const setFitVersion = silent((lesson: Lesson, version: number): Lesson => {
  if (lesson.fitVersion === version) return lesson;
  return editQuietly(lesson, (l) => {
    l.fitVersion = version;
  });
});
