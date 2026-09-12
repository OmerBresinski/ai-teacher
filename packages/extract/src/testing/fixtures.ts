import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
} from "docx";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";

/*
 * Generated documents for tests (`@tj/extract/testing`): nothing binary lives in git. Every
 * builder is deterministic for a given input, network-free and runs in a few milliseconds.
 */

/** A 1×1 red PNG, the smallest valid raster we need for "has an image" cases. */
export const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/** A 64×64 opaque PNG (the smallest `extractPdf` keeps). */
export async function squarePng(side = 64): Promise<Uint8Array> {
  const { encodePng } = await import("../formats/png");
  const data = new Uint8Array(side * side * 3).fill(200);
  const png = encodePng({ data, width: side, height: side, channels: 3 });
  if (png === null) throw new Error("squarePng: encode failed");
  return png;
}

/** One page per entry; an empty string leaves that page blank. */
export async function pdfWithPages(
  pages: string[],
  opts: { imageOnPage?: number } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = opts.imageOnPage !== undefined ? await pdf.embedPng(await squarePng()) : null;
  pages.forEach((text, i) => {
    const page = pdf.addPage([595, 842]);
    if (text.length > 0) {
      let y = 780;
      for (const line of text.split("\n")) {
        page.drawText(line, { x: 50, y, size: 12, font });
        y -= 18;
      }
    }
    if (image && opts.imageOnPage === i + 1) {
      page.drawImage(image, { x: 50, y: 100, width: 200, height: 200 });
    }
  });
  return new Uint8Array(await pdf.save());
}

export interface DocxBlock {
  heading?: string;
  paragraphs?: string[];
  table?: string[][];
  image?: Uint8Array;
}

export async function docxWith(blocks: DocxBlock[]): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];
  for (const block of blocks) {
    if (block.heading) {
      children.push(new Paragraph({ text: block.heading, heading: HeadingLevel.HEADING_1 }));
    }
    for (const p of block.paragraphs ?? []) children.push(new Paragraph(p));
    if (block.table) {
      children.push(
        new Table({
          rows: block.table.map(
            (cells) =>
              new TableRow({
                children: cells.map((c) => new TableCell({ children: [new Paragraph(c)] })),
              }),
          ),
        }),
      );
    }
    if (block.image) {
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: block.image,
              transformation: { width: 64, height: 64 },
            }),
          ],
        }),
      );
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

export interface PptxSlide {
  /** Text runs; each entry becomes one paragraph. */
  paragraphs: string[];
  notes?: string;
  table?: string[][];
  /** A PNG placed on this slide via `ppt/media` + `_rels`. */
  image?: Uint8Array;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function paragraphXml(text: string): string {
  return `<a:p><a:r><a:rPr lang="en-GB"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>`;
}

function tableXml(rows: string[][]): string {
  const trs = rows
    .map(
      (r) =>
        `<a:tr h="370840">${r
          .map((c) => `<a:tc><a:txBody><a:bodyPr/>${paragraphXml(c)}</a:txBody></a:tc>`)
          .join("")}</a:tr>`,
    )
    .join("");
  return `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid/>${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/**
 * A minimal PPTX: the slide files, notes, rels and media the extractor reads. `slideNumbers`
 * lets a test write slides under out-of-order names (e.g. [3, 1, 2]) to check numeric sorting.
 */
export async function pptxWith(
  slides: PptxSlide[],
  opts: { slideNumbers?: number[] } = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldIdLst/></p:presentation>`,
  );
  slides.forEach((slide, i) => {
    const n = opts.slideNumbers?.[i] ?? i + 1;
    const body = slide.paragraphs.map(paragraphXml).join("");
    const shapes = `<p:sp><p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>${slide.table ? tableXml(slide.table) : ""}${slide.image ? '<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>' : ""}`;
    zip.file(
      `ppt/slides/slide${n}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`,
    );
    if (slide.notes !== undefined) {
      zip.file(
        `ppt/notesSlides/notesSlide${n}.xml`,
        `<?xml version="1.0" encoding="UTF-8"?><p:notes ${NS}><p:cSld><p:spTree><p:sp><p:txBody>${paragraphXml(slide.notes)}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
      );
    }
    if (slide.image) {
      zip.file(`ppt/media/image${n}.png`, slide.image);
      zip.file(
        `ppt/slides/_rels/slide${n}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.png"/></Relationships>`,
      );
    }
  });
  return zip.generateAsync({ type: "uint8array" });
}

/** A zip that is neither a PPTX nor a DOCX. */
export async function plainZip(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("hello.txt", "hi");
  return zip.generateAsync({ type: "uint8array" });
}

/**
 * A PPTX whose one slide entry inflates past `uncompressedBytes` (highly compressible zeros), for
 * the zip-bomb cap. Generating 200 MB of zeros takes ~1 s; tests pass a smaller cap through
 * `LIMITS` mocking or accept the second.
 */
export async function pptxBomb(uncompressedBytes: number): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `<p:presentation ${NS}/>`);
  zip.file("ppt/slides/slide1.xml", new Uint8Array(uncompressedBytes), {
    compression: "DEFLATE",
  });
  return zip.generateAsync({ type: "uint8array" });
}

/** A DOCX whose `word/document.xml` inflates past `uncompressedBytes`; mammoth must never see it. */
export async function docxBomb(uncompressedBytes: number): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("word/document.xml", new Uint8Array(uncompressedBytes), { compression: "DEFLATE" });
  return zip.generateAsync({ type: "uint8array" });
}

/** A PPTX whose slide XML is the given raw string (for malformed and entity cases). */
export async function pptxWithRawSlide(slideXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `<p:presentation ${NS}/>`);
  zip.file("ppt/slides/slide1.xml", slideXml);
  return zip.generateAsync({ type: "uint8array" });
}

/** A class-list table: header then six rows of full names with dates of birth. */
export const ROSTER_ROWS: string[][] = [
  ["Name", "DoB", "Class"],
  ["Amelia Jones", "12/03/2014", "5B"],
  ["Oliver Smith", "03/07/2014", "5B"],
  ["Isla Brown", "21/11/2013", "5B"],
  ["George Taylor", "08/01/2014", "5B"],
  ["Ava Wilson", "30/05/2014", "5B"],
  ["Noah Davies", "17/09/2013", "5B"],
];

/** Scientists and the years they were born: names beside years, which is not a roster. */
export const SCIENTISTS_ROWS: string[][] = [
  ["Scientist", "Born"],
  ["Marie Curie", "1867"],
  ["Isaac Newton", "1643"],
  ["Rosalind Franklin", "1920"],
  ["Charles Darwin", "1809"],
  ["Ada Lovelace", "1815"],
  ["Alan Turing", "1912"],
];

export const PHOTOSYNTHESIS = [
  "Photosynthesis is the process by which green plants make their own food. Light energy from the sun is absorbed by chlorophyll in the leaves and used to turn carbon dioxide and water into glucose and oxygen.",
  "Chlorophyll is the green pigment found in chloroplasts. Plants need light, water and carbon dioxide; without any one of these the rate of photosynthesis falls. Oxygen leaves through the stomata.",
];
