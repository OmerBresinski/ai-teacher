import type { Lesson, Worksheet } from "@tj/domain/documents";
import { parseLesson, parseWorksheet } from "@tj/domain/documents";
import { cloneSlide, newLesson, newWorksheet, starterLesson, starterWorksheet } from "@tj/editor";
import { seedLibrary } from "./library-fixtures";
import type { DocumentKind, DocumentSummary, Series, SeriesWithLessons } from "./library-schema";
import { isLessonBody, type StoredDocument, summarise } from "./summarise";

const LATENCY_MS = import.meta.env.MODE === "test" ? 0 : 120;

/**
 * Full documents (ADR 0021, ADR 0020 amendment): the store holds the editor document and derives
 * every library summary from it with `summarise`. `loadDocument` returns the body the editor
 * edits; `saveDocument` replaces it. A reload reseeds.
 *
 * This module carries the seed content, the document factories (`@tj/editor`) and the validators
 * (`@tj/domain/documents`). `lib/library.ts` imports it lazily so none of that sits in the initial
 * bundle (ADR 0022 §8); tests import it directly.
 */
const documents = new Map<string, StoredDocument>();
const series = new Map<string, Series>();

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function seed(): void {
  const seeded = seedLibrary(new Date());
  documents.clear();
  series.clear();
  for (const document of seeded.documents) documents.set(document.body.id, copy(document));
  for (const entry of seeded.series) series.set(entry.id, copy(entry));
}

function timestamp(): string {
  return new Date().toISOString();
}

function liveDocument(id: string): StoredDocument | undefined {
  const stored = documents.get(id);
  return stored && !stored.deletedAt ? stored : undefined;
}

function liveSeries(id: string): Series | undefined {
  const entry = series.get(id);
  return entry && !entry.deletedAt ? entry : undefined;
}

function resolveSeries(entry: Series): SeriesWithLessons {
  const lessons = entry.lessonIds.flatMap((id) => {
    const stored = liveDocument(id);
    return stored && isLessonBody(stored.body) ? [summarise(stored)] : [];
  });
  return { series: copy(entry), lessons };
}

/** Validate a body the way an import is validated, so the store never holds a shape the editor cannot open. */
function validate(body: Lesson | Worksheet): Lesson | Worksheet {
  return isLessonBody(body) ? parseLesson(body) : parseWorksheet(body);
}

seed();

export async function resetLibraryStore(): Promise<void> {
  await delay();
  seed();
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  await delay();
  return [...documents.values()]
    .filter((stored) => !stored.deletedAt)
    .map(summarise)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The full editor document, or null when it is missing or in the bin. */
export async function loadDocument(id: string): Promise<Lesson | Worksheet | null> {
  await delay();
  const stored = liveDocument(id);
  return stored ? copy(stored.body) : null;
}

/**
 * Replace a document with the editor's copy. The body is validated first and the stored one is
 * untouched when validation fails; `updatedAt` is stamped here so the card order follows edits.
 */
export async function saveDocument(body: Lesson | Worksheet): Promise<void> {
  await delay();
  const next = validate(copy(body));
  const stored = documents.get(next.id);
  if (!stored) throw new Error(`No document ${next.id} to save into.`);
  next.updatedAt = timestamp();
  documents.set(next.id, { ...stored, body: next });
}

// The input contract mirrors what the real API will receive so the mock→API swap does not change
// call sites (TEACH-88/91); the body is built with the editor's factories (ADR 0021).
export async function createDocument(input: {
  kind: DocumentKind;
  title: string;
  themeId: string;
  subject?: string;
  yearGroup?: string;
  readingLevel?: string;
  language?: string;
  start?: string;
}): Promise<DocumentSummary> {
  await delay();
  const title = input.title.trim();
  const starter = input.start !== "blank";
  const body: Lesson | Worksheet =
    input.kind === "lesson"
      ? starter
        ? starterLesson(title, input.themeId)
        : newLesson(title, input.themeId)
      : starter
        ? starterWorksheet(title, input.themeId)
        : newWorksheet(title, input.themeId);
  body.id = crypto.randomUUID();
  if (input.subject) body.subject = input.subject;
  if (input.yearGroup) body.yearGroup = input.yearGroup;
  if (input.readingLevel) body.readingLevel = input.readingLevel;
  if (input.language) body.language = input.language;
  const stored: StoredDocument = { body };
  documents.set(body.id, stored);
  return summarise(stored);
}

export async function renameDocument(id: string, title: string): Promise<boolean> {
  await delay();
  const stored = documents.get(id);
  const trimmed = title.trim();
  if (!stored || !trimmed) return false;
  documents.set(id, {
    ...stored,
    body: { ...stored.body, title: trimmed, updatedAt: timestamp() },
  });
  return true;
}

export async function duplicateDocument(
  id: string,
  newTitle?: string,
): Promise<DocumentSummary | null> {
  await delay();
  const source = liveDocument(id);
  if (!source) return null;
  const now = timestamp();
  const body = copy(source.body);
  body.id = crypto.randomUUID();
  body.title = (newTitle ?? `${source.body.title} (copy)`).trim();
  body.createdAt = now;
  body.updatedAt = now;
  // Fresh element ids too, so a copy can later sit beside its source in one document safely.
  if (isLessonBody(body)) body.slides = body.slides.map(cloneSlide);
  const stored: StoredDocument = { body };
  documents.set(body.id, stored);
  return summarise(stored);
}

export async function softDeleteDocument(id: string): Promise<boolean> {
  await delay();
  const stored = documents.get(id);
  if (!stored) return false;
  const now = timestamp();
  documents.set(id, { body: { ...stored.body, updatedAt: now }, deletedAt: now });
  return true;
}

export async function restoreDocument(id: string): Promise<boolean> {
  await delay();
  const stored = documents.get(id);
  if (!stored) return false;
  documents.set(id, { body: { ...stored.body, updatedAt: timestamp() } });
  return true;
}

export async function purgeDocument(id: string): Promise<void> {
  await delay();
  documents.delete(id);
  const now = timestamp();
  for (const entry of series.values()) {
    if (!entry.lessonIds.includes(id)) continue;
    series.set(entry.id, {
      ...entry,
      lessonIds: entry.lessonIds.filter((lessonId) => lessonId !== id),
      updatedAt: now,
    });
  }
}

export async function listSeriesWithLessons(): Promise<SeriesWithLessons[]> {
  await delay();
  return [...series.values()]
    .filter((entry) => !entry.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(resolveSeries);
}

export async function loadSeriesWithLessons(id: string): Promise<SeriesWithLessons | null> {
  await delay();
  const entry = liveSeries(id);
  return entry ? resolveSeries(entry) : null;
}

export async function createSeries(title: string, lessonIds: string[] = []): Promise<Series> {
  await delay();
  const now = timestamp();
  const entry: Series = {
    id: crypto.randomUUID(),
    title: title.trim(),
    lessonIds: [...lessonIds],
    createdAt: now,
    updatedAt: now,
  };
  series.set(entry.id, entry);
  return copy(entry);
}

export async function renameSeries(id: string, title: string): Promise<boolean> {
  await delay();
  const entry = series.get(id);
  const trimmed = title.trim();
  if (!entry || !trimmed) return false;
  series.set(id, { ...entry, title: trimmed, updatedAt: timestamp() });
  return true;
}

export async function duplicateSeries(id: string, newTitle?: string): Promise<Series | null> {
  await delay();
  const source = liveSeries(id);
  if (!source) return null;
  const now = timestamp();
  const entry: Series = {
    id: crypto.randomUUID(),
    title: (newTitle ?? `${source.title} (copy)`).trim(),
    lessonIds: [...source.lessonIds],
    createdAt: now,
    updatedAt: now,
  };
  series.set(entry.id, entry);
  return copy(entry);
}

export async function addLessonsToSeries(
  id: string,
  lessonIds: string[],
  at?: number,
): Promise<Series | null> {
  await delay();
  const entry = liveSeries(id);
  if (!entry) return null;
  const existing = new Set(entry.lessonIds);
  const additions = lessonIds.filter((lessonId) => {
    if (existing.has(lessonId)) return false;
    existing.add(lessonId);
    return true;
  });
  if (additions.length === 0) return copy(entry);
  const index =
    at === undefined ? entry.lessonIds.length : Math.max(0, Math.min(entry.lessonIds.length, at));
  const updated = {
    ...entry,
    lessonIds: [...entry.lessonIds.slice(0, index), ...additions, ...entry.lessonIds.slice(index)],
    updatedAt: timestamp(),
  };
  series.set(id, updated);
  return copy(updated);
}

export async function removeLessonFromSeries(id: string, lessonId: string): Promise<Series | null> {
  await delay();
  const entry = liveSeries(id);
  if (!entry) return null;
  if (!entry.lessonIds.includes(lessonId)) return copy(entry);
  const updated = {
    ...entry,
    lessonIds: entry.lessonIds.filter((id) => id !== lessonId),
    updatedAt: timestamp(),
  };
  series.set(id, updated);
  return copy(updated);
}

export async function setSeriesLessons(id: string, lessonIds: string[]): Promise<Series | null> {
  await delay();
  const entry = liveSeries(id);
  if (!entry) return null;
  const held = new Set(entry.lessonIds);
  const next = lessonIds.filter((lessonId) => held.has(lessonId));
  const unchanged =
    next.length === entry.lessonIds.length &&
    next.every((lessonId, index) => lessonId === entry.lessonIds[index]);
  if (unchanged) return copy(entry);
  const updated = { ...entry, lessonIds: next, updatedAt: timestamp() };
  series.set(id, updated);
  return copy(updated);
}

export async function softDeleteSeries(id: string): Promise<boolean> {
  await delay();
  const entry = series.get(id);
  if (!entry) return false;
  series.set(id, { ...entry, deletedAt: timestamp(), updatedAt: timestamp() });
  return true;
}

export async function restoreSeries(id: string): Promise<boolean> {
  await delay();
  const entry = series.get(id);
  if (!entry) return false;
  const restored = { ...entry, updatedAt: timestamp() };
  delete restored.deletedAt;
  series.set(id, restored);
  return true;
}

export async function purgeSeries(id: string): Promise<void> {
  await delay();
  series.delete(id);
}
