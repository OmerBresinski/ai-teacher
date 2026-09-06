import { describe, expect, test } from "bun:test";
import { lesson, titleSlide, worksheet } from "./fixtures.test-helpers";
import type { Series } from "./series";
import { DocumentKindSchema, DocumentSummarySchema, documentKind, summarise } from "./summarise";

const series = (): Series => ({
  id: "series-fractions",
  title: "Fractions fortnight",
  lessonIds: ["l1", "l2", "l3"],
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-05T15:30:00.000Z",
});

describe("summarise", () => {
  test("a lesson: slide count, first slide as cover, theme, subject and year group", () => {
    const slides = Array.from({ length: 12 }, (_, i) => ({ ...titleSlide(), id: `s${i}` }));
    const doc = { ...lesson(), slides };
    const summary = summarise(doc);
    expect(summary).toEqual({
      id: doc.id,
      kind: "lesson" as const,
      title: doc.title,
      subject: "Science",
      yearGroup: "Year 4",
      themeId: "chalk",
      itemCount: 12,
      cover: slides[0] ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
    expect(DocumentSummarySchema.safeParse(summary).success).toBe(true);
  });

  test("a lesson with no slides has a null cover", () => {
    expect(summarise({ ...lesson(), slides: [] })).toMatchObject({ itemCount: 0, cover: null });
  });

  test("a worksheet: block count (not pages), null cover, its own theme", () => {
    const blocks = Array.from({ length: 7 }, (_, i) => ({
      id: `b${i}`,
      type: "divider" as const,
    }));
    const doc = { ...worksheet(), blocks, subject: "Maths", yearGroup: "Year 3" };
    const summary = summarise(doc);
    expect(summary).toEqual({
      id: doc.id,
      kind: "worksheet" as const,
      title: doc.title,
      subject: "Maths",
      yearGroup: "Year 3",
      themeId: "playground",
      itemCount: 7,
      cover: null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
    expect(DocumentSummarySchema.safeParse(summary).success).toBe(true);
  });

  test("a series: lesson count, null cover, no theme, subject or year group", () => {
    const summary = summarise(series());
    expect(summary).toEqual({
      id: "series-fractions",
      kind: "series" as const,
      title: "Fractions fortnight",
      itemCount: 3,
      cover: null,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-05T15:30:00.000Z",
    });
    expect(summary).not.toHaveProperty("themeId");
    expect(DocumentSummarySchema.safeParse(summary).success).toBe(true);
  });

  test("the summary survives JSON (undefined optionals drop out)", () => {
    const summary = summarise(series());
    expect(DocumentSummarySchema.parse(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
  });
});

describe("documentKind", () => {
  test("distinguishes the three kinds", () => {
    expect(documentKind(lesson())).toBe("lesson");
    expect(documentKind(worksheet())).toBe("worksheet");
    expect(documentKind(series())).toBe("series");
  });

  test("DocumentKindSchema lists exactly the three kinds", () => {
    expect(DocumentKindSchema.options).toEqual(["lesson", "worksheet", "series"]);
  });
});
