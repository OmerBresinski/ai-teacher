import { seedLibrary } from "./library-fixtures";
import type { DocumentKind, DocumentSummary, Series, SeriesWithLessons } from "./library-schema";

const LATENCY_MS = import.meta.env.MODE === "test" ? 0 : 120;

const documents = new Map<string, DocumentSummary>();
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
  for (const document of seeded.documents) documents.set(document.id, copy(document));
  for (const entry of seeded.series) series.set(entry.id, copy(entry));
}

function timestamp(): string {
  return new Date().toISOString();
}

function liveSeries(id: string): Series | undefined {
  const entry = series.get(id);
  return entry && !entry.deletedAt ? entry : undefined;
}

function resolveSeries(entry: Series): SeriesWithLessons {
  const lessons = entry.lessonIds.flatMap((id) => {
    const document = documents.get(id);
    return document && document.kind === "lesson" && !document.deletedAt ? [copy(document)] : [];
  });
  return { series: copy(entry), lessons };
}

seed();

export async function resetLibraryStore(): Promise<void> {
  await delay();
  seed();
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  await delay();
  return [...documents.values()]
    .filter((document) => !document.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(copy);
}

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
  const now = timestamp();
  const document: DocumentSummary = {
    id: crypto.randomUUID(),
    kind: input.kind,
    title: input.title.trim(),
    count: input.kind === "lesson" ? 6 : 4,
    createdAt: now,
    updatedAt: now,
    themeId: input.themeId,
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.yearGroup ? { yearGroup: input.yearGroup } : {}),
  };
  documents.set(document.id, document);
  return copy(document);
}

export async function renameDocument(id: string, title: string): Promise<boolean> {
  await delay();
  const document = documents.get(id);
  const trimmed = title.trim();
  if (!document || !trimmed) return false;
  documents.set(id, { ...document, title: trimmed, updatedAt: timestamp() });
  return true;
}

export async function duplicateDocument(
  id: string,
  newTitle?: string,
): Promise<DocumentSummary | null> {
  await delay();
  const source = documents.get(id);
  if (!source || source.deletedAt) return null;
  const now = timestamp();
  const document: DocumentSummary = {
    ...source,
    id: crypto.randomUUID(),
    title: (newTitle ?? `${source.title} (copy)`).trim(),
    createdAt: now,
    updatedAt: now,
  };
  delete document.deletedAt;
  documents.set(document.id, document);
  return copy(document);
}

export async function softDeleteDocument(id: string): Promise<boolean> {
  await delay();
  const document = documents.get(id);
  if (!document) return false;
  documents.set(id, { ...document, deletedAt: timestamp(), updatedAt: timestamp() });
  return true;
}

export async function restoreDocument(id: string): Promise<boolean> {
  await delay();
  const document = documents.get(id);
  if (!document) return false;
  const restored = { ...document, updatedAt: timestamp() };
  delete restored.deletedAt;
  documents.set(id, restored);
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
