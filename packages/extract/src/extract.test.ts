import { describe, expect, test } from "bun:test";
import { ExtractError, extract, LIMITS, MIME, PASTE_SECTION, sniffMime } from "./index";
import {
  docxBomb,
  docxWith,
  PHOTOSYNTHESIS,
  pdfWithPages,
  plainZip,
  pptxBomb,
  pptxWith,
  pptxWithRawSlide,
  ROSTER_ROWS,
  squarePng,
  TINY_PNG,
} from "./testing/fixtures";

describe("sniffMime", () => {
  test("pdf, docx and pptx by magic bytes and zip contents; anything else is null", async () => {
    expect(await sniffMime(await pdfWithPages(["a"]))).toBe(MIME.pdf);
    expect(await sniffMime(await docxWith([{ paragraphs: ["a"] }]))).toBe(MIME.docx);
    expect(await sniffMime(await pptxWith([{ paragraphs: ["a"] }]))).toBe(MIME.pptx);
    expect(await sniffMime(await plainZip())).toBeNull();
    expect(await sniffMime(TINY_PNG)).toBeNull();
    expect(await sniffMime(new TextEncoder().encode("hello"))).toBeNull();
    expect(await sniffMime(new Uint8Array())).toBeNull();
  });

  test("a truncated zip is malformed, not a crash with library text", async () => {
    const bytes = (await plainZip()).slice(0, 12);
    await expect(sniffMime(bytes)).rejects.toBeInstanceOf(ExtractError);
  });
});

describe("extract pdf", () => {
  test("one chunk per page with page locators; blank pages are skipped but counted", async () => {
    const bytes = await pdfWithPages([PHOTOSYNTHESIS[0] ?? "", "", PHOTOSYNTHESIS[1] ?? ""]);
    const out = await extract({ bytes, mime: MIME.pdf, name: "plants.pdf" });
    expect(out.kind).toBe("pdf");
    expect(out.pages).toBe(3);
    expect(out.chunks.map((c) => c.ref)).toEqual([{ page: 1 }, { page: 3 }]);
    expect(out.chunks[0]?.text).toContain("Photosynthesis");
    expect(out.chunks[1]?.text).toContain("Chlorophyll");
    expect(out.tables).toEqual([]);
    expect(out.images).toEqual([]);
  });

  test("embedded pictures come out as PNGs with the page locator", async () => {
    const bytes = await pdfWithPages(["Look at this", ""], { imageOnPage: 2 });
    const out = await extract({ bytes, mime: MIME.pdf, name: "pic.pdf" });
    expect(out.images).toHaveLength(1);
    expect(out.images[0]?.ref).toEqual({ page: 2 });
    expect(out.images[0]?.mime).toBe("image/png");
    expect(Array.from(out.images[0]?.bytes.slice(0, 4) ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("garbage with a PDF header is malformed and carries no cause or input text", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 nonsense SECRET-TOKEN");
    const error = await extract({ bytes, mime: MIME.pdf, name: "x.pdf" }).catch((e) => e);
    expect(error).toBeInstanceOf(ExtractError);
    expect(error).toMatchObject({
      code: "malformed",
      format: "pdf",
      message: "extract(pdf): malformed",
    });
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("SECRET");
  });
});

describe("extract pptx", () => {
  test("slides sort numerically, notes append, tables and images are found", async () => {
    const bytes = await pptxWith(
      [
        { paragraphs: ["Third slide"] },
        { paragraphs: ["First slide", "with two paragraphs"], notes: "say hello" },
        { paragraphs: ["Second slide"], table: ROSTER_ROWS.slice(0, 2), image: TINY_PNG },
      ],
      { slideNumbers: [3, 1, 2] },
    );
    const out = await extract({ bytes, mime: MIME.pptx, name: "deck.pptx" });
    expect(out.kind).toBe("pptx");
    expect(out.pages).toBe(3);
    expect(out.chunks.map((c) => c.ref)).toEqual([{ slide: 1 }, { slide: 2 }, { slide: 3 }]);
    expect(out.chunks[0]?.text).toBe("First slide\nwith two paragraphs\nNotes: say hello");
    expect(out.chunks[1]?.text).toContain("Second slide");
    expect(out.tables).toEqual([{ ref: { slide: 2 }, rows: ROSTER_ROWS.slice(0, 2) }]);
    expect(out.images).toHaveLength(1);
    expect(out.images[0]).toMatchObject({ ref: { slide: 2 }, mime: "image/png" });
  });

  test("a slide with no text contributes no chunk but still counts as a page", async () => {
    const bytes = await pptxWith([{ paragraphs: [], image: TINY_PNG }, { paragraphs: ["Hi"] }]);
    const out = await extract({ bytes, mime: MIME.pptx, name: "deck.pptx" });
    expect(out.pages).toBe(2);
    expect(out.chunks.map((c) => c.ref)).toEqual([{ slide: 2 }]);
  });

  test("entries that inflate past the cap are too-large", async () => {
    const bytes = await pptxBomb(LIMITS.maxUncompressedBytes + 1);
    await expect(extract({ bytes, mime: MIME.pptx, name: "bomb.pptx" })).rejects.toMatchObject({
      code: "too-large",
      format: "pptx",
    });
  }, 30_000);
});

describe("extract pptx: hostile input", () => {
  test("malformed slide XML is malformed, with no parser message or input text", async () => {
    const bytes = await pptxWithRawSlide("<p:sld><a:t>SECRET-TOKEN</a:t><unclosed");
    const error = await extract({ bytes, mime: MIME.pptx, name: "x.pptx" }).catch((e) => e);
    expect(error).toMatchObject({ name: "ExtractError", code: "malformed", format: "pptx" });
    expect((error as Error).cause).toBeUndefined();
    expect((error as Error).message).not.toContain("SECRET");
  });

  test("DTD entities are never expanded; the built-ins are", async () => {
    const bytes = await pptxWithRawSlide(
      `<?xml version="1.0"?><!DOCTYPE p [<!ENTITY lol "lollollol"><!ENTITY lol2 "&lol;&lol;&lol;">]>` +
        `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>&lol2; a &amp; b &lt;c&gt; &#233;</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const out = await extract({ bytes, mime: MIME.pptx, name: "x.pptx" });
    expect(out.chunks[0]?.text).not.toContain("lollollol");
    expect(out.chunks[0]?.text).toContain("a & b <c> é");
  });
});

describe("extract docx", () => {
  test("headings start sections; tables and images sit under their section", async () => {
    const png = await squarePng();
    const bytes = await docxWith([
      { paragraphs: ["Before any heading."] },
      { heading: "Cells", paragraphs: ["Cells are the building blocks of life."] },
      {
        heading: "Membrane",
        paragraphs: ["The membrane controls what enters."],
        table: [
          ["Part", "Job"],
          ["Nucleus", "Control"],
        ],
        image: png,
      },
    ]);
    const out = await extract({ bytes, mime: MIME.docx, name: "cells.docx" });
    expect(out.kind).toBe("docx");
    expect(out.pages).toBe(1);
    expect(out.chunks.map((c) => c.ref)).toEqual([
      { section: "Start" },
      { section: "Cells" },
      { section: "Membrane" },
    ]);
    expect(out.chunks[1]?.text).toBe("Cells are the building blocks of life.");
    expect(out.tables).toEqual([
      {
        ref: { section: "Membrane" },
        rows: [
          ["Part", "Job"],
          ["Nucleus", "Control"],
        ],
      },
    ]);
    expect(out.images).toHaveLength(1);
    expect(out.images[0]).toMatchObject({ ref: { section: "Membrane" }, mime: "image/png" });
  });

  test("an archive that inflates past the cap is too-large before mammoth runs", async () => {
    const bytes = await docxBomb(LIMITS.maxUncompressedBytes + 1);
    await expect(extract({ bytes, mime: MIME.docx, name: "bomb.docx" })).rejects.toMatchObject({
      code: "too-large",
      format: "docx",
    });
  }, 30_000);

  test("a zip without word/document.xml is malformed", async () => {
    await expect(
      extract({ bytes: await plainZip(), mime: MIME.docx, name: "x.docx" }),
    ).rejects.toMatchObject({ code: "malformed", format: "docx" });
  });
});

describe("extract paste", () => {
  test("one chunk; tab-separated lines become a table", async () => {
    const text = `Class list\n${ROSTER_ROWS.map((r) => r.join("\t")).join("\n")}`;
    const out = await extract({
      bytes: new TextEncoder().encode(text),
      mime: MIME.paste,
      name: "Pasted text",
    });
    expect(out.kind).toBe("paste");
    expect(out.pages).toBe(1);
    expect(out.chunks).toEqual([{ ref: { section: PASTE_SECTION }, text }]);
    expect(out.tables).toEqual([{ ref: { section: PASTE_SECTION }, rows: ROSTER_ROWS }]);
  });

  test("prose has no table; empty text has no chunk", async () => {
    const prose = await extract({
      bytes: new TextEncoder().encode("Just a paragraph.\nAnother one."),
      mime: MIME.paste,
      name: "p",
    });
    expect(prose.tables).toEqual([]);
    const empty = await extract({ bytes: new Uint8Array(), mime: MIME.paste, name: "p" });
    expect(empty.chunks).toEqual([]);
  });
});
