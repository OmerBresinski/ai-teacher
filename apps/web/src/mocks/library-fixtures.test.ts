import { describe, expect, it } from "bun:test";
import { isLesson, parseLesson, parseWorksheet } from "@tj/domain/documents";
import { THEMES } from "@tj/editor";
import { LIBRARY_THEMES, seedLibrary } from "./library-fixtures";
import { DocumentSummary, LibraryTheme, Series } from "./library-schema";
import { summarise } from "./summarise";

describe("seedLibrary", () => {
  it("creates a schema-valid, varied library", () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const library = seedLibrary(now);

    const lessons = library.documents.filter((document) => isLesson(document.body));
    expect(lessons).toHaveLength(10);
    expect(library.documents).toHaveLength(14);
    expect(library.series).toHaveLength(2);
    // Every seeded body is a valid document and every summary derived from it is schema-valid.
    for (const { body } of library.documents) {
      expect(() => ("slides" in body ? parseLesson(body) : parseWorksheet(body))).not.toThrow();
    }
    expect(() => DocumentSummary.array().parse(library.documents.map(summarise))).not.toThrow();
    // Every lesson has a first slide to paint and the two demo lessons keep TeachDeck's ids.
    for (const { body } of lessons) expect(summarise({ body }).cover).not.toBeNull();
    expect(library.documents.map((d) => d.body.id)).toEqual(
      expect.arrayContaining(["demo-water-cycle", "demo-fractions", "fraction-practice"]),
    );
    // The picker table mirrors the editor catalogue: same ids, names and ground/ink colours.
    expect(LIBRARY_THEMES.map((t) => [t.id, t.name, t.swatch, t.ink])).toEqual(
      THEMES.map((t) => [t.id, t.name, t.colors.background, t.colors.ink]),
    );
    // Every fixture theme is one the catalogue knows, so covers paint in their own colours.
    const known = new Set(LIBRARY_THEMES.map((theme) => theme.id));
    for (const { body } of library.documents) expect(known.has(body.themeId)).toBe(true);
    expect(() => Series.array().parse(library.series)).not.toThrow();
    expect(() => LibraryTheme.array().parse(LIBRARY_THEMES)).not.toThrow();

    const membership = new Map<string, number>();
    for (const entry of library.series) {
      for (const id of entry.lessonIds) membership.set(id, (membership.get(id) ?? 0) + 1);
    }
    expect([...membership.values()].some((count) => count > 1)).toBe(true);

    const ages = library.documents.map(
      (document) => now.getTime() - Date.parse(document.body.updatedAt),
    );
    expect(ages.filter((age) => age < 7 * 24 * 60 * 60 * 1000).length).toBeGreaterThanOrEqual(3);
    expect(ages.filter((age) => age > 7 * 24 * 60 * 60 * 1000).length).toBeGreaterThanOrEqual(3);
  });
});
