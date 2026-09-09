import { describe, expect, test } from "bun:test";
import { lesson, text, titleSlide, worksheet } from "./fixtures.test-helpers";
import type { Series } from "./series";
import type { Slide, SlideElement } from "./slide";
import {
  COVER_BLOCKS,
  COVER_TEXT_CHARS,
  coverOf,
  DocumentKindSchema,
  DocumentSummarySchema,
  documentKind,
  isWorksheetCover,
  summarise,
  worksheetCoverOf,
  worksheetMarks,
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
    if (!cover || isWorksheetCover(cover)) throw new Error("expected a slide cover");
    const els = cover.elements;
    expect(els[0]?.type === "image" && els[0].src).toBe("");
    expect(els[1]?.type === "image" && els[1].src).toBe("/files/abc");
    const group = els[2];
    const nested = group?.type === "group" ? group.children[0] : undefined;
    expect(nested?.type === "image" && nested.src).toBe("");
    expect(cover.background?.image).toBe("");
    // The document itself is untouched.
    const original = doc.slides[0]?.elements[0];
    expect(original?.type === "image" && original.src).toBe(dataUrl);
    expect(doc.slides[0]?.background?.image).toBe(dataUrl);
    expect(coverOf(doc)).not.toBe(doc.slides[0]);
  });

  test("a worksheet: block count (not pages), page 1 as cover, its own theme", () => {
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
      marks: 0,
      cover: { kind: "worksheet", header: doc.header, blocks: doc.blocks, pageSize: "A4" },
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
    expect(DocumentSummarySchema.safeParse(summary).success).toBe(true);
    expect(isWorksheetCover(summary.cover)).toBe(true);
    expect(isWorksheetCover(summarise(lesson()).cover)).toBe(false);
    expect(isWorksheetCover(null)).toBe(false);
  });

  test("a worksheet cover: the header and the first blocks, page breaks dropped, text clipped, images kept (TEACH-193)", () => {
    const long = "x".repeat(COVER_TEXT_CHARS + 40);
    const svg = `data:image/svg+xml;utf8,${encodeURIComponent("<svg/>")}`;
    const huge = `data:image/png;base64,${"A".repeat(20_000)}`;
    const doc = {
      ...worksheet(),
      pageSize: "Letter" as const,
      showMarks: true,
      blocks: [
        { id: "p", type: "paragraph" as const, doc: text(long) },
        { id: "brk", type: "page-break" as const },
        { id: "i1", type: "image" as const, src: svg, widthPct: 50 },
        { id: "i2", type: "image" as const, src: "/files/abc", widthPct: 50 },
        { id: "i3", type: "image" as const, src: huge, widthPct: 50 },
        ...Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, type: "divider" as const })),
      ],
    };
    const cover = worksheetCoverOf(doc);
    expect(cover.kind).toBe("worksheet");
    expect(cover.pageSize).toBe("Letter");
    expect(cover.showMarks).toBe(true);
    expect(cover.header).toEqual(doc.header);
    expect(cover.header).not.toBe(doc.header);
    expect(cover.blocks).toHaveLength(COVER_BLOCKS);
    expect(cover.blocks.some((b) => b.type === "page-break")).toBe(false);
    const para = cover.blocks[0];
    const clipped = para?.type === "paragraph" ? para.doc.content?.[0]?.content?.[0]?.text : "";
    expect(clipped).toHaveLength(COVER_TEXT_CHARS);
    // The document keeps its full text.
    expect(
      doc.blocks[0]?.type === "paragraph" && doc.blocks[0].doc.content?.[0]?.content?.[0]?.text,
    ).toHaveLength(COVER_TEXT_CHARS + 40);
    const [, i1, i2, i3] = cover.blocks;
    expect(i1?.type === "image" && i1.src).toBe(svg);
    expect(i2?.type === "image" && i2.src).toBe("/files/abc");
    expect(i3?.type === "image" && i3.src).toBe("");
    expect(doc.blocks[4]?.type === "image" && doc.blocks[4].src).toBe(huge);
    // The union parses both shapes and rejects a tagged cover with no blocks.
    expect(DocumentSummarySchema.safeParse({ ...summarise(doc), cover }).success).toBe(true);
    expect(
      DocumentSummarySchema.safeParse({ ...summarise(doc), cover: { kind: "worksheet" } }).success,
    ).toBe(false);
    expect(
      DocumentSummarySchema.safeParse({ ...summarise(lesson()), cover: summarise(doc).cover })
        .success,
    ).toBe(true);
  });

  test("a worksheet's marks are the sum of its question blocks' marks (TEACH-186)", () => {
    const doc = worksheet();
    const question = (id: string, marks?: number) =>
      ({ id, type: "question", doc: text("Q"), answerLines: 2, marks }) as const;
    doc.blocks = [
      question("a", 1),
      question("b", 3),
      question("c"),
      { id: "d", type: "divider" },
      {
        id: "e",
        type: "multiple-choice",
        doc: text("Which?"),
        options: [{ id: "o", text: "A", correct: true }],
      },
    ];
    expect(worksheetMarks(doc.blocks)).toBe(4);
    expect(summarise(doc).marks).toBe(4);
    expect(summarise(lesson()).marks).toBeUndefined();
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
