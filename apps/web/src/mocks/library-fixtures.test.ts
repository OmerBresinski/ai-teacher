import { describe, expect, it } from "bun:test";
import { LIBRARY_THEMES, seedLibrary } from "./library-fixtures";
import { DocumentSummary, LibraryTheme, Series } from "./library-schema";

describe("seedLibrary", () => {
  it("creates a schema-valid, varied library", () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const library = seedLibrary(now);

    expect(library.documents.filter((document) => document.kind === "lesson")).toHaveLength(10);
    expect(library.documents.filter((document) => document.kind === "worksheet")).toHaveLength(4);
    expect(library.series).toHaveLength(2);
    expect(() => DocumentSummary.array().parse(library.documents)).not.toThrow();
    expect(() => Series.array().parse(library.series)).not.toThrow();
    expect(() => LibraryTheme.array().parse(LIBRARY_THEMES)).not.toThrow();

    const membership = new Map<string, number>();
    for (const entry of library.series) {
      for (const id of entry.lessonIds) membership.set(id, (membership.get(id) ?? 0) + 1);
    }
    expect([...membership.values()].some((count) => count > 1)).toBe(true);

    const ages = library.documents.map(
      (document) => now.getTime() - Date.parse(document.updatedAt),
    );
    expect(ages.filter((age) => age < 7 * 24 * 60 * 60 * 1000).length).toBeGreaterThanOrEqual(3);
    expect(ages.filter((age) => age > 7 * 24 * 60 * 60 * 1000).length).toBeGreaterThanOrEqual(3);
  });
});
