import { beforeEach, describe, expect, it } from "bun:test";
import {
  addLessonsToSeries,
  createDocument,
  listDocuments,
  listSeriesWithLessons,
  loadSeriesWithLessons,
  purgeDocument,
  renameDocument,
  resetLibraryStore,
  restoreDocument,
  restoreSeries,
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
});
