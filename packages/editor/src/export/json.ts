import { type Lesson, parseLesson, parseWorksheet, type Worksheet } from "@tj/domain/documents";
import { downloadBlob } from "./download";

/**
 * JSON export and import (TeachDeck `lib/export/json.ts`; ADR 0021 §7, ADR 0023 §6). The file is
 * the document exactly as it is stored, so an export is a backup and an import is validated by the
 * same Zod schemas the api runs (`parseLesson` / `parseWorksheet` call `migrate()` first, so a
 * newer-version file is refused with TeachDeck's copy before any request is made). Image `src`
 * values are written as stored — a `/files/<key>` another Workspace cannot read renders broken
 * there, by design (ADR 0023 amendment 2026-09-12).
 */

/** "The water cycle" → "the-water-cycle". Always yields something usable. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "untitled";
}

export const lessonFilename = (lesson: Lesson) => `${slugify(lesson.title)}.teachdeck.json`;
export const worksheetFilename = (worksheet: Worksheet) =>
  `${slugify(worksheet.title)}.worksheet.json`;

/** The bytes a JSON export writes: pretty-printed, so a diff of two backups reads. */
export function documentJsonBlob(document: Lesson | Worksheet): Blob {
  return new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
}

export function downloadLessonJSON(lesson: Lesson): void {
  downloadBlob(documentJsonBlob(lesson), lessonFilename(lesson));
}

export function downloadWorksheetJSON(worksheet: Worksheet): void {
  downloadBlob(documentJsonBlob(worksheet), worksheetFilename(worksheet));
}

async function readJSON(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`"${file.name}" is not a JSON file.`);
  }
}

export async function readLessonFile(file: File): Promise<Lesson> {
  return parseLesson(await readJSON(file));
}

export async function readWorksheetFile(file: File): Promise<Worksheet> {
  return parseWorksheet(await readJSON(file));
}

/** Import either kind from one drop target: the library accepts both. */
export async function readDocumentFile(file: File): Promise<Lesson | Worksheet> {
  const json = await readJSON(file);
  const asRecord = json as { blocks?: unknown };
  return asRecord && typeof asRecord === "object" && "blocks" in asRecord
    ? parseWorksheet(json)
    : parseLesson(json);
}
