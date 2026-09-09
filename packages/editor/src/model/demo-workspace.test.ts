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

  it("gives the two demo lessons their facts, and the other lessons none (TEACH-184)", () => {
    const facts = new Map(
      library.filter((d) => d.kind === "lesson").map((d) => [d.key, d.body.facts]),
    );
    expect(facts.get("demo-water-cycle")?.misconceptions).toHaveLength(4);
    expect(facts.get("demo-water-cycle")?.vocabulary).toHaveLength(6);
    const fractions = facts.get("demo-fractions");
    expect(fractions?.objectives).toHaveLength(3);
    expect(fractions?.vocabulary).toHaveLength(4);
    expect(fractions?.workedExamples).toHaveLength(1);
    expect(fractions?.questions).toHaveLength(4);
    expect(fractions?.misconceptions).toHaveLength(2);
    expect(fractions?.outline.length).toBeGreaterThan(0);
    // The outline adds up to the duration, as the worker's would.
    for (const key of ["demo-water-cycle", "demo-fractions"]) {
      const f = facts.get(key);
      expect(f?.outline.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(f?.durationMin);
    }
    for (const [key, value] of facts) {
      if (key !== "demo-water-cycle" && key !== "demo-fractions") expect(value).toBeUndefined();
    }
  });

  it("seeds four real worksheets, one per job, with Fractions practice belonging to its lesson", () => {
    const worksheets = library.filter((d) => d.kind === "worksheet");
    expect(worksheets.map((d) => d.body.title)).toEqual([
      "Fractions practice",
      "Roman source investigation",
      "Label a flowering plant",
      "River vocabulary",
    ]);
    const lessonKeys = new Set(library.filter((d) => d.kind === "lesson").map((d) => d.key));
    for (const document of worksheets) {
      if (document.kind !== "worksheet") continue;
      // The paper says what the card says, and nothing is the placeholder starter.
      expect(document.body.header.title).toBe(document.body.title);
      const copy = JSON.stringify(document.body.blocks);
      expect(copy).not.toContain("Write your first question here");
      expect(document.body.blocks.length).toBeGreaterThanOrEqual(3);
      expect(summarise(document.body).marks).toBeGreaterThanOrEqual(0);
      // A worksheet's `lessonId` is a lesson key until the seeder maps it (TEACH-186).
      if (document.body.lessonId !== undefined)
        expect(lessonKeys.has(document.body.lessonId)).toBe(true);
    }
    const fractions = worksheets.find((d) => d.key === "fraction-practice");
    expect(fractions?.kind === "worksheet" ? fractions.body.lessonId : null).toBe("demo-fractions");
    expect(fractions?.kind === "worksheet" ? summarise(fractions.body).marks : 0).toBe(12);
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
