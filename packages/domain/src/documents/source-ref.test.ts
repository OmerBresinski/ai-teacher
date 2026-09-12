import { describe, expect, test } from "bun:test";
import { ExtractedSourceSchema, SourceLocatorSchema, SourceRefSchema } from "./source-ref";

describe("SourceRefSchema", () => {
  test("a file reference round-trips; a paste needs no storage key", () => {
    const file = {
      id: "src1",
      kind: "file" as const,
      name: "plan.pdf",
      storageKey: "ws/x/plan.pdf",
      pages: 3,
    };
    expect(SourceRefSchema.parse(file)).toEqual(file);
    const paste = { id: "src2", kind: "paste" as const, name: "Pasted text" };
    expect(SourceRefSchema.parse(paste)).toEqual(paste);
  });

  test("carries references only: extracted text is not a field (strict)", () => {
    expect(
      SourceRefSchema.safeParse({ id: "s", kind: "paste", name: "n", text: "the whole document" })
        .success,
    ).toBe(false);
  });

  test("rejects an unknown kind and a negative or fractional page count", () => {
    expect(SourceRefSchema.safeParse({ id: "s", kind: "url", name: "n" }).success).toBe(false);
    expect(SourceRefSchema.safeParse({ id: "s", kind: "file", name: "n", pages: -1 }).success).toBe(
      false,
    );
    expect(
      SourceRefSchema.safeParse({ id: "s", kind: "file", name: "n", pages: 1.5 }).success,
    ).toBe(false);
  });
});

describe("SourceLocatorSchema", () => {
  test("accepts page, slide or section locators and an empty one", () => {
    for (const ref of [{ page: 3 }, { slide: 4 }, { section: "Cells" }, {}]) {
      expect(SourceLocatorSchema.parse(ref)).toEqual(ref);
    }
  });

  test("rejects page 0, a fractional slide, a long section and unknown keys", () => {
    expect(SourceLocatorSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ slide: 1.5 }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ section: "x".repeat(121) }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ line: 2 }).success).toBe(false);
  });
});

describe("ExtractedSourceSchema", () => {
  const extracted = {
    version: 1 as const,
    sourceId: "src1",
    kind: "pdf" as const,
    pages: 2,
    lowText: false,
    chunks: [
      { ref: { page: 1 }, text: "Photosynthesis" },
      { ref: { page: 2 }, text: "Chlorophyll" },
    ],
    images: [{ ref: { page: 2 }, storageKey: "ws/sources/src1/img/1.png", mime: "image/png" }],
  };

  test("round-trips", () => {
    expect(ExtractedSourceSchema.parse(extracted)).toEqual(extracted);
  });

  test("rejects another version, a bad locator and image bytes", () => {
    expect(ExtractedSourceSchema.safeParse({ ...extracted, version: 2 }).success).toBe(false);
    expect(
      ExtractedSourceSchema.safeParse({
        ...extracted,
        chunks: [{ ref: { page: 0 }, text: "x" }],
      }).success,
    ).toBe(false);
    expect(
      ExtractedSourceSchema.safeParse({
        ...extracted,
        images: [{ ...extracted.images[0], bytes: "AAAA" }],
      }).success,
    ).toBe(false);
  });
});
