import { describe, expect, it } from "bun:test";
import {
  DocumentSummarySchema,
  parseLesson,
  parseSeries,
  parseWorksheet,
  summarise,
} from "@tj/domain/documents";
import { demoWorkspace } from "./demo-workspace";
import { THEMES } from "./themes";

describe("demoWorkspace", () => {
  const now = new Date("2026-09-05T12:00:00.000Z");
  const library = demoWorkspace(now);

  it("creates a schema-valid, varied library", () => {
    expect(library.filter((d) => d.kind === "lesson")).toHaveLength(10);
    expect(library.filter((d) => d.kind === "worksheet")).toHaveLength(4);
    expect(library.filter((d) => d.kind === "series")).toHaveLength(2);
    for (const document of library) {
      const parse =
        document.kind === "lesson"
          ? parseLesson
          : document.kind === "worksheet"
            ? parseWorksheet
            : parseSeries;
      expect(() => parse(document.body)).not.toThrow();
      expect(() => DocumentSummarySchema.parse(summarise(document.body))).not.toThrow();
      // Keys are unique and double as the body id until a seeder assigns the real one.
      expect(document.body.id).toBe(document.key);
    }
    expect(new Set(library.map((d) => d.key)).size).toBe(library.length);
    // Every lesson has a first slide to paint; every theme is one the catalogue knows.
    const known = new Set(THEMES.map((theme) => theme.id));
    for (const document of library) {
      if (document.kind === "series") continue;
      expect(known.has(document.body.themeId)).toBe(true);
      if (document.kind === "lesson") expect(summarise(document.body).cover).not.toBeNull();
    }
  });

  it("lists every lesson before the series that reference it", () => {
    const seen = new Set<string>();
    for (const document of library) {
      if (document.kind === "series") {
        for (const key of document.body.lessonIds) expect(seen.has(key)).toBe(true);
      }
      seen.add(document.key);
    }
    // One lesson sits in two series, as the library's membership rule allows.
    const membership = new Map<string, number>();
    for (const document of library) {
      if (document.kind !== "series") continue;
      for (const key of document.body.lessonIds) {
        membership.set(key, (membership.get(key) ?? 0) + 1);
      }
    }
    expect([...membership.values()].some((count) => count > 1)).toBe(true);
  });

  it("spreads edits across the Recent / Earlier boundary", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const ages = library
      .filter((d) => d.kind !== "series")
      .map((document) => now.getTime() - Date.parse(document.body.updatedAt));
    expect(ages.filter((age) => age < week).length).toBeGreaterThanOrEqual(3);
    expect(ages.filter((age) => age > week).length).toBeGreaterThanOrEqual(3);
  });
});
