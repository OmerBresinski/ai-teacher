import { beforeEach, describe, expect, it } from "bun:test";
import { isLesson, parseLesson, parseWorksheet } from "@tj/domain/documents";
import { STARTER_KINDS } from "@tj/editor";
import {
  addLessonsToSeries,
  createDocument,
  duplicateDocument,
  listDocuments,
  listSeriesWithLessons,
  loadDocument,
  loadSeriesWithLessons,
  purgeDocument,
  renameDocument,
  resetLibraryStore,
  restoreDocument,
  restoreSeries,
  saveDocument,
  softDeleteDocument,
  softDeleteSeries,
} from "./library-store";

beforeEach(resetLibraryStore);

describe("library store", () => {
  it("hides a soft-deleted document from the library and series rows until restored", async () => {
    await expect(softDeleteDocument("demo-fractions")).resolves.toBe(true);
    await expect(listDocuments()).resolves.not.toContainEqual(
      expect.objectContaining({ id: "demo-fractions" }),
    );

    const beforeRestore = await loadSeriesWithLessons("series-fractions");
    expect(beforeRestore?.series.lessonIds).toContain("demo-fractions");
    expect(beforeRestore?.lessons).not.toContainEqual(
      expect.objectContaining({ id: "demo-fractions" }),
    );

    await expect(restoreDocument("demo-fractions")).resolves.toBe(true);
    const restored = await loadSeriesWithLessons("series-fractions");
    expect(restored?.lessons).toContainEqual(expect.objectContaining({ id: "demo-fractions" }));
  });

  it("removes a purged document from all series memberships", async () => {
    await purgeDocument("demo-fractions");
    const rows = await listSeriesWithLessons();
    expect(rows.every((row) => !row.series.lessonIds.includes("demo-fractions"))).toBe(true);
  });

  it("restores a soft-deleted series with its lesson order intact", async () => {
    const before = await loadSeriesWithLessons("series-romans");
    await expect(softDeleteSeries("series-romans")).resolves.toBe(true);
    await expect(loadSeriesWithLessons("series-romans")).resolves.toBeNull();
    await expect(restoreSeries("series-romans")).resolves.toBe(true);
    expect((await loadSeriesWithLessons("series-romans"))?.series.lessonIds).toEqual(
      before?.series.lessonIds,
    );
  });

  it("adds each new lesson once and leaves existing memberships in place", async () => {
    const before = await loadSeriesWithLessons("series-fractions");
    const updated = await addLessonsToSeries("series-fractions", [
      "roman-roads",
      "roman-roads",
      "demo-fractions",
    ]);

    expect(before).not.toBeNull();
    expect(updated?.lessonIds).toEqual([...(before?.series.lessonIds ?? []), "roman-roads"]);
  });

  it("trims document titles and returns false for an unknown document", async () => {
    await expect(renameDocument("demo-water-cycle", "  X  ")).resolves.toBe(true);
    await expect(renameDocument("missing", "X")).resolves.toBe(false);
    await expect(listDocuments()).resolves.toContainEqual(
      expect.objectContaining({ id: "demo-water-cycle", title: "X" }),
    );
  });

  it("returns copies rather than references to stored data", async () => {
    const documents = await listDocuments();
    const firstDocument = documents[0];
    if (!firstDocument) throw new Error("Expected seeded documents");
    const originalDocumentTitle = firstDocument.title;
    firstDocument.title = "Changed by caller";

    const rows = await listSeriesWithLessons();
    const firstRow = rows[0];
    if (!firstRow) throw new Error("Expected seeded series");
    const originalLessonIds = [...firstRow.series.lessonIds];
    const firstLesson = firstRow.lessons[0];
    if (!firstLesson) throw new Error("Expected seeded series lessons");
    const originalLessonTitle = firstLesson.title;
    firstRow.series.lessonIds.pop();
    firstRow.series.lessonIds.push("caller-added");
    firstLesson.title = "Changed by caller";

    const created = await createDocument({
      kind: "lesson",
      title: "New",
      themeId: "chalk",
      readingLevel: "easy",
    });
    created.title = "Changed by caller";

    await expect(listDocuments()).resolves.toContainEqual(
      expect.objectContaining({ id: firstDocument.id, title: originalDocumentTitle }),
    );
    await expect(listDocuments()).resolves.toContainEqual(
      expect.objectContaining({ id: created.id, title: "New" }),
    );

    const reloaded = await loadSeriesWithLessons(firstRow.series.id);
    expect(reloaded?.series.lessonIds).toEqual(originalLessonIds);
    expect(reloaded?.lessons).toContainEqual(
      expect.objectContaining({ id: firstLesson.id, title: originalLessonTitle }),
    );
  });

  it("summaries are derived from the bodies: counts and covers match the documents", async () => {
    const summaries = await listDocuments();
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) {
      const body = await loadDocument(summary.id);
      if (!body) throw new Error(`missing ${summary.id}`);
      if (isLesson(body)) {
        expect(summary.kind).toBe("lesson");
        expect(summary.count).toBe(body.slides.length);
        expect(summary.cover?.id).toBe(body.slides[0]?.id);
      } else {
        expect(summary.kind).toBe("worksheet");
        expect(summary.count).toBe(body.blocks.length);
        expect(summary.cover).toBeNull();
      }
    }
  });

  it("loads TeachDeck's demo lesson as a full, valid document", async () => {
    const body = await loadDocument("demo-water-cycle");
    if (!body || !isLesson(body)) throw new Error("demo lesson missing");
    expect(() => parseLesson(body)).not.toThrow();
    expect(body.title).toBe("The water cycle");
    expect(body.slides.length).toBeGreaterThanOrEqual(5);
  });

  it("saveDocument replaces the body, restamps updatedAt and recomputes the summary", async () => {
    const body = await loadDocument("demo-fractions");
    if (!body || !isLesson(body)) throw new Error("demo lesson missing");
    const before = (await listDocuments()).find((d) => d.id === body.id);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await saveDocument({ ...body, title: "New", slides: body.slides.slice(0, 2) });
    const after = (await listDocuments()).find((d) => d.id === body.id);
    expect(after?.title).toBe("New");
    expect(after?.count).toBe(2);
    expect(after && before && after.updatedAt > before.updatedAt).toBe(true);
    const reloaded = await loadDocument(body.id);
    expect(reloaded && isLesson(reloaded) && reloaded.slides.length).toBe(2);
  });

  it("saveDocument rejects an invalid body and leaves the stored one untouched", async () => {
    const body = await loadDocument("demo-fractions");
    if (!body) throw new Error("demo lesson missing");
    await expect(saveDocument({ ...body, version: 2 } as never)).rejects.toThrow(/newer version/);
    const reloaded = await loadDocument("demo-fractions");
    expect(reloaded?.title).toBe(body.title);
  });

  it("createDocument builds a starter lesson by default and a blank one on request", async () => {
    const starter = await createDocument({ kind: "lesson", title: "X", themeId: "exam-hall" });
    const body = await loadDocument(starter.id);
    if (!body || !isLesson(body)) throw new Error("lesson missing");
    expect(body.slides.map((s) => s.kind)).toEqual(STARTER_KINDS);
    expect(body.themeId).toBe("exam-hall");
    expect(starter.count).toBe(STARTER_KINDS.length);

    const blank = await createDocument({
      kind: "lesson",
      title: "Y",
      themeId: "chalk",
      start: "blank",
    });
    const blankBody = await loadDocument(blank.id);
    expect(blankBody && isLesson(blankBody) && blankBody.slides.map((s) => s.kind)).toEqual([
      "title",
    ]);
  });

  it("createDocument builds a valid worksheet whose count is its block count", async () => {
    const summary = await createDocument({ kind: "worksheet", title: "W", themeId: "chalk" });
    const body = await loadDocument(summary.id);
    if (!body || isLesson(body)) throw new Error("worksheet missing");
    expect(() => parseWorksheet(body)).not.toThrow();
    expect(summary.count).toBe(body.blocks.length);
    expect(summary.cover).toBeNull();
  });

  it("duplicateDocument copies the content under a new document id and fresh slide ids", async () => {
    const source = await loadDocument("demo-water-cycle");
    const copy = await duplicateDocument("demo-water-cycle");
    if (!source || !copy || !isLesson(source)) throw new Error("fixture missing");
    const body = await loadDocument(copy.id);
    if (!body || !isLesson(body)) throw new Error("copy missing");
    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe("The water cycle (copy)");
    expect(body.slides).toHaveLength(source.slides.length);
    const sourceIds = new Set(source.slides.map((s) => s.id));
    for (const slide of body.slides) expect(sourceIds.has(slide.id)).toBe(false);
    expect(body.slides.map((s) => s.kind)).toEqual(source.slides.map((s) => s.kind));
  });
});
