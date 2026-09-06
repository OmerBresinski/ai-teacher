import { describe, expect, test } from "bun:test";
import { lesson, titleSlide, worksheet } from "./fixtures.test-helpers";
import type { Series } from "./series";
import type { Slide, SlideElement } from "./slide";
import {
  coverOf,
  DocumentKindSchema,
  DocumentSummarySchema,
  documentKind,
  summarise,
} from "./summarise";

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

  test("the cover strips data-URL images (elements, groups, background) without touching the lesson", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const image = (id: string, src: string): SlideElement => ({
      id,
      type: "image",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      src,
      fit: "cover",
    });
    const first: Slide = {
      ...titleSlide(),
      background: { image: dataUrl },
      elements: [
        image("i1", dataUrl),
        image("i2", "/files/abc"),
        { id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [image("i3", dataUrl)] },
      ],
    };
    const doc = { ...lesson(), slides: [first] };
    const cover = summarise(doc).cover;
    expect(cover).not.toBeNull();
    const els = cover?.elements ?? [];
    expect(els[0]?.type === "image" && els[0].src).toBe("");
    expect(els[1]?.type === "image" && els[1].src).toBe("/files/abc");
    const group = els[2];
    const nested = group?.type === "group" ? group.children[0] : undefined;
    expect(nested?.type === "image" && nested.src).toBe("");
    expect(cover?.background?.image).toBe("");
    // The document itself is untouched.
    const original = doc.slides[0]?.elements[0];
    expect(original?.type === "image" && original.src).toBe(dataUrl);
    expect(doc.slides[0]?.background?.image).toBe(dataUrl);
    expect(coverOf(doc)).not.toBe(doc.slides[0]);
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
