/**
 * Word export for worksheets (TeachDeck `lib/export/docx.ts`; ADR 0023 §4, §7 and the 2026-09-12
 * amendment). Reached only through `await import("./docx")` from `ExportControl`, so `docx` never
 * sits in a route chunk.
 *
 * The sheet is rebuilt as a real Word document — paragraphs, tables, ruled lines and embedded
 * images — never a picture of a page. A teacher opens the .docx to change a question, not to look
 * at it, so every word has to be selectable and every box has to be a real table.
 *
 * Images. TeachDeck embedded data URLs only. Here an image block's `src` is `/files/:key` on the
 * api origin behind the session cookie, so the bytes are fetched first — with the cookie for the
 * api origin and without it for any other (`imageCredentials`, TEACH-272 §1) — and a picture that
 * cannot be fetched or read leaves a line the teacher can act on. Runs in Bun for the tests:
 * nothing here touches the DOM.
 */

import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  HeightRule,
  type IBorderOptions,
  ImageRun,
  type ISectionOptions,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  type ParagraphChild,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { answerKey, matchingOrder, optionLetter } from "../worksheet/answers";
import { LINE_GAP, PAGE_PAD, pageMetrics } from "../worksheet/metrics";
import { buildWordSearch, solutionMask, wordSearchLead } from "../worksheet/word-search";
import { imageCredentials } from "./image-credentials";
import { slugify } from "./json";
import { docToRuns, type Run, type RunParagraph } from "./runs";

/* ------------------------------------------------------------------ */
/* Units and shared furniture                                          */
/* ------------------------------------------------------------------ */

/** Word measures in twentieths of a point. */
const twip = (pt: number) => Math.round(pt * 20);
/** Run sizes are in half-points. */
const halfPt = (pt: number) => Math.round(pt * 2);
/** docx sizes images in CSS pixels at 96dpi. */
const px = (pt: number) => Math.round((pt * 96) / 72);

const BODY_PT = 11;
const INK = "1A1A1A";
const RULE = "9A9A9A";

const hairline: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const noBorder: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

const boxBorders = {
  top: hairline,
  bottom: hairline,
  left: hairline,
  right: hairline,
  insideHorizontal: hairline,
  insideVertical: hairline,
};

/**
 * The one numbering definition every ordered list in the document points at.
 *
 * Word does not number a paragraph because it was written as a list: numbering
 * lives in `numbering.xml` and a paragraph refers to it. Without this a
 * numbered list exports as unnumbered, unindented body text.
 */
const ORDERED_LIST = "td-ordered";

/** The lane the question number sits in on the sheet, kept clear here too. */
const QUESTION_GUTTER = 28;

/** Nine levels, because Word's own outline goes nine deep and a paste can too. */
const orderedLevels = Array.from({ length: 9 }, (_, level) => ({
  level,
  format: LevelFormat.DECIMAL,
  text: `%${level + 1}.`,
  alignment: AlignmentType.START,
  style: {
    paragraph: { indent: { left: twip(18 * (level + 1)), hanging: twip(14) } },
  },
}));

/** A ruled answer line: an empty paragraph with a rule under it. */
function ruledLine(): Paragraph {
  return new Paragraph({
    text: "",
    spacing: { before: twip(LINE_GAP - 6), after: 0 },
    border: { bottom: hairline },
  });
}

function textRun(run: Run, extra: { size?: number; font?: string } = {}): TextRun {
  return new TextRun({
    text: run.text,
    bold: run.bold,
    italics: run.italic,
    underline: run.underline ? {} : undefined,
    strike: run.strike,
    color: INK,
    ...extra,
  });
}

/** One rich-text doc as Word paragraphs, marks and lists intact. */
function richParagraphs(
  paragraphs: RunParagraph[],
  options: {
    size?: number;
    italics?: boolean;
    bold?: boolean;
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
  } = {},
): Paragraph[] {
  const size = halfPt(options.size ?? BODY_PT);
  return paragraphs.map((para) => {
    const children = para.runs.map((run) =>
      textRun(
        { ...run, italic: run.italic || options.italics, bold: run.bold || options.bold },
        { size },
      ),
    );
    return new Paragraph({
      children: children.length > 0 ? children : [new TextRun({ text: "", size })],
      heading: options.heading,
      bullet: para.list === "bullet" ? { level: para.level } : undefined,
      numbering:
        para.list === "ordered" ? { reference: ORDERED_LIST, level: para.level } : undefined,
      spacing: { after: twip(4) },
    });
  });
}

function plain(
  text: string,
  options: {
    size?: number;
    bold?: boolean;
    italics?: boolean;
    after?: number;
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  } = {},
): Paragraph {
  return new Paragraph({
    alignment: options.alignment,
    spacing: { after: twip(options.after ?? 6) },
    children: [
      new TextRun({
        text,
        bold: options.bold,
        italics: options.italics,
        color: INK,
        size: halfPt(options.size ?? BODY_PT),
      }),
    ],
  });
}

/** The stem of a numbered block: "3. Name the process…" plus its marks. */
function numberedStem(
  number: number | undefined,
  paragraphs: RunParagraph[],
  marks?: number,
): Paragraph[] {
  const label = number ? `${number}. ` : "";
  const marksText = marks ? `  (${marks} ${marks === 1 ? "mark" : "marks"})` : "";
  const first = paragraphs[0]?.runs ?? [];
  const head = new Paragraph({
    spacing: { after: twip(4) },
    children: [
      new TextRun({ text: label, bold: true, color: INK, size: halfPt(BODY_PT) }),
      ...first.map((run) => textRun(run)),
      ...(marksText ? [new TextRun({ text: marksText, color: INK, size: halfPt(BODY_PT) })] : []),
    ],
  });
  return [head, ...richParagraphs(paragraphs.slice(1))];
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

type DecodedImage = {
  bytes: Uint8Array;
  type: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
};

const IMAGE_TYPES: Record<string, DecodedImage["type"]> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/**
 * Pixel size read out of the bytes themselves. Word needs a width and a height
 * for every picture, and a data URL carries neither.
 *
 * Null when the bytes do not say. A guessed 4:3 is worse than no picture: the
 * teacher gets a stretched or squashed image with no sign anything went wrong,
 * where a missing one is a line they can act on.
 */
function pixelSize(
  bytes: Uint8Array,
  type: DecodedImage["type"],
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // A header that reads as zero (or negative) is a truncated or corrupt file,
  // not a picture, so it is refused along with the ones that never parsed.
  const real = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;
  try {
    if (type === "png") return real(view.getUint32(16), view.getUint32(20));
    if (type === "gif") return real(view.getUint16(6, true), view.getUint16(8, true));
    if (type === "bmp") return real(view.getInt32(18, true), Math.abs(view.getInt32(22, true)));
    // JPEG: walk the segments to the first start-of-frame.
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1] ?? 0;
      const length = view.getUint16(offset + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return real(view.getUint16(offset + 7), view.getUint16(offset + 5));
      }
      offset += 2 + length;
    }
  } catch {
    // A header that runs off the end of the buffer: nothing to read.
  }
  return null;
}

/** A data URL Word can embed, or null for anything else. */
export function decodeImage(src: string): DecodedImage | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(src.trim());
  if (!match) return null;
  const type = IMAGE_TYPES[(match[1] ?? "").toLowerCase()];
  if (!type) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(match[2] ?? "");
  } catch {
    // Not base64 after all: one bad picture is a line on the sheet, never a lost export.
    return null;
  }
  const size = pixelSize(bytes, type);
  if (!size) return null;
  return { bytes, type, ...size };
}

/**
 * The bytes behind a block's `src`: decoded from a data URL, or fetched — with the session cookie
 * for the api origin only (TEACH-272 §1) — and typed from the response. Null when the picture
 * cannot be had, so the block writes its "left out" line instead of failing the whole file.
 */
export async function resolveImage(
  src: string,
  imageOrigin: string | undefined,
): Promise<DecodedImage | null> {
  const trimmed = src.trim();
  if (/^data:/i.test(trimmed)) return decodeImage(trimmed);
  if (!/^(https?:)?\//i.test(trimmed)) return null;
  try {
    const response = await fetch(trimmed, {
      mode: "cors",
      credentials: imageCredentials(trimmed, imageOrigin),
    });
    if (!response.ok) return null;
    const type =
      IMAGE_TYPES[
        (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
      ];
    if (!type) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const size = pixelSize(bytes, type);
    return size ? { bytes, type, ...size } : null;
  } catch {
    return null;
  }
}

/** The pictures a build needs, resolved up front so the block walk itself stays synchronous. */
export type ResolvedImages = ReadonlyMap<string, DecodedImage | null>;

async function resolveImages(
  worksheet: Worksheet,
  imageOrigin: string | undefined,
): Promise<ResolvedImages> {
  const out = new Map<string, DecodedImage | null>();
  await Promise.all(
    worksheet.blocks
      .filter(
        (block): block is Extract<WorksheetBlock, { type: "image" }> => block.type === "image",
      )
      .map(async (block) => {
        out.set(block.id, await resolveImage(block.src, imageOrigin));
      }),
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

function wordSearchTable(
  block: Extract<WorksheetBlock, { type: "word-search" }>,
  solved: boolean,
  contentW: number,
): (Paragraph | Table)[] {
  const { grid, error } = buildWordSearch(block);
  if (!grid) return [plain(error, { italics: true, size: 10 })];

  const mask = solved ? solutionMask(grid) : null;
  // 26pt cells, unless that would run the grid past the text column. Word does
  // not shrink a table to fit the page: an over-wide one runs into the margin
  // and off the paper.
  const cell = Math.min(26, (contentW - QUESTION_GUTTER) / grid.size);
  const rows = grid.rows.map(
    (row, r) =>
      new TableRow({
        height: { value: twip(cell), rule: HeightRule.EXACT },
        children: row.map(
          (letter, c) =>
            new TableCell({
              width: { size: twip(cell), type: WidthType.DXA },
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: twip(5), after: 0 },
                  children: [
                    new TextRun({
                      text: letter,
                      font: "Consolas",
                      // Bold alone is hard to pick out of a grid of capitals,
                      // and the key is read across a desk at speed. Underlined
                      // as well, so it survives a greyscale photocopy too.
                      bold: !!mask?.[r]?.[c],
                      underline: mask?.[r]?.[c] ? {} : undefined,
                      color: INK,
                      size: halfPt(12),
                    }),
                  ],
                }),
              ],
            }),
        ),
      }),
  );

  const out: (Paragraph | Table)[] = [
    new Table({
      alignment: AlignmentType.CENTER,
      width: { size: twip(cell * grid.size), type: WidthType.DXA },
      borders: boxBorders,
      rows,
    }),
  ];

  // The bank lists what is in the grid, not what was typed: a word the
  // generator could not place is not on the paper to be found.
  const words = grid.placements.map((placement) => placement.word);
  if (block.showWordBank && words.length > 0) {
    out.push(plain(words.join("    "), { alignment: AlignmentType.CENTER, after: 10 }));
  }
  if (solved) {
    out.push(
      plain("The answers are the letters in bold and underlined.", { italics: true, size: 10 }),
    );
  }
  return out;
}

/** Everything one block contributes to the document, in order. */
function blockChildren(
  block: WorksheetBlock,
  contentW: number,
  images: ResolvedImages,
): (Paragraph | Table)[] {
  switch (block.type) {
    case "heading":
      return richParagraphs(docToRuns(block.doc), {
        size: block.level === 1 ? 14 : 12,
        bold: true,
        heading: block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
      });

    case "paragraph":
      return richParagraphs(docToRuns(block.doc));

    case "instructions":
      return richParagraphs(docToRuns(block.doc), { size: 10.5, italics: true });

    case "question":
      return [
        ...numberedStem(block.number, docToRuns(block.doc), block.marks),
        ...Array.from({ length: block.answerLines }, () => ruledLine()),
        plain("", { after: 6 }),
      ];

    case "multiple-choice":
      return [
        ...numberedStem(block.number, docToRuns(block.doc)),
        ...block.options.map((option, i) =>
          plain(`☐  ${optionLetter(i)}  ${option.text}`, { after: 4 }),
        ),
      ];

    case "fill-gap": {
      // Every gap token becomes a blank as wide as the answer that fills it.
      const text = docToRuns(block.doc)
        .map((para) => para.runs.map((run) => run.text).join(""))
        .join("\n")
        .replace(/\[\[gap:([^\]]+)\]\]/g, (_match, id: string) => {
          const gap = block.gaps.find((g) => g.id === id);
          return "_".repeat(Math.max(10, (gap?.answer.length ?? 8) + 4));
        });
      return text.split("\n").map((line, i) =>
        i === 0
          ? new Paragraph({
              spacing: { after: twip(6) },
              children: [
                new TextRun({
                  text: block.number ? `${block.number}. ` : "",
                  bold: true,
                  color: INK,
                  size: halfPt(BODY_PT),
                }),
                new TextRun({ text: line, color: INK, size: halfPt(BODY_PT) }),
              ],
            })
          : plain(line),
      );
    }

    case "matching": {
      const order = matchingOrder(block.id, block.pairs.length);
      const rightOf = (i: number) => block.pairs[order[i] ?? i]?.right ?? "";
      return [
        ...numberedStem(block.number, [
          { runs: [{ text: "Match each term to its meaning." }], level: 0 },
        ]),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: noBorder,
            bottom: noBorder,
            left: noBorder,
            right: noBorder,
            insideHorizontal: noBorder,
            insideVertical: noBorder,
          },
          rows: block.pairs.map(
            (pair, i) =>
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: [plain(`${pair.left}   ______`, { after: 4 })],
                  }),
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: [plain(`${optionLetter(i)}  ${rightOf(i)}`, { after: 4 })],
                  }),
                ],
              }),
          ),
        }),
      ];
    }

    case "word-search": {
      // The same lead the sheet prints, off the same function: the count of
      // hidden words has to match the grid in both.
      const { grid } = buildWordSearch(block);
      const lead = wordSearchLead(
        block.directions,
        grid?.placements.length ?? 0,
        block.showWordBank,
      );
      return [
        ...numberedStem(block.number, [{ runs: [{ text: lead }], level: 0 }]),
        ...wordSearchTable(block, false, contentW),
      ];
    }

    case "word-bank":
      return [
        plain("Word bank", { size: 9.5, after: 3 }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: boxBorders,
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  margins: { top: twip(8), bottom: twip(8), left: twip(10), right: twip(10) },
                  children: [
                    plain(block.words.join("        "), {
                      alignment: AlignmentType.CENTER,
                      after: 0,
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        plain("", { after: 6 }),
      ];

    case "answer-box":
      return [
        ...(block.label ? [plain(block.label, { size: 9.5, after: 3 })] : []),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: boxBorders,
          rows: [
            new TableRow({
              height: { value: twip(block.heightPt), rule: HeightRule.ATLEAST },
              children: [new TableCell({ children: [plain("", { after: 0 })] })],
            }),
          ],
        }),
        plain("", { after: 6 }),
      ];

    case "lines":
      return [...Array.from({ length: block.count }, () => ruledLine()), plain("", { after: 6 })];

    case "image": {
      const image = images.get(block.id) ?? null;
      if (!image) {
        // Two ways to have no picture, and a teacher can only act on the one they are told
        // about: bytes that do not decode, or a picture that could not be fetched (a `/files/`
        // reference from another Workspace, a broken link).
        const why = /^data:/i.test(block.src.trim())
          ? "Image left out: the file could not be read."
          : "Image left out: it could not be fetched.";
        return [plain(why, { italics: true, size: 10 })];
      }
      const widthPt = (contentW * block.widthPct) / 100;
      const heightPt = (widthPt * image.height) / image.width;
      const children: ParagraphChild[] = [
        new ImageRun({
          data: image.bytes,
          type: image.type,
          transformation: { width: px(widthPt), height: px(heightPt) },
          altText: block.alt
            ? { name: "Image", description: block.alt, title: block.alt }
            : undefined,
        }),
      ];
      return [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: twip(4) }, children }),
        ...(block.caption
          ? [plain(block.caption, { size: 9.5, alignment: AlignmentType.CENTER, after: 8 })]
          : []),
      ];
    }

    case "table":
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: boxBorders,
          rows: block.rows.map(
            (row, r) =>
              new TableRow({
                tableHeader: r === 0 && !!block.header,
                children: row.map(
                  (cellText) =>
                    new TableCell({
                      margins: { top: twip(4), bottom: twip(4), left: twip(6), right: twip(6) },
                      children: [plain(cellText, { bold: r === 0 && !!block.header, after: 0 })],
                    }),
                ),
              }),
          ),
        }),
        plain("", { after: 6 }),
      ];

    case "divider":
      return [
        new Paragraph({
          text: "",
          spacing: { before: twip(6), after: twip(8) },
          border: { bottom: hairline },
        }),
      ];

    case "page-break":
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

/* ------------------------------------------------------------------ */
/* Header, self-assessment, answer key                                 */
/* ------------------------------------------------------------------ */

function headerChildren(worksheet: Worksheet): (Paragraph | Table)[] {
  const { header } = worksheet;
  const fields: string[] = [];
  if (header.showName) fields.push("Name: ______________________________");
  if (header.showDate) fields.push("Date: ____________________");
  if (header.showClass) fields.push("Class: ____________________");

  const out: (Paragraph | Table)[] = [];
  if (fields.length > 0) {
    out.push(
      new Paragraph({
        spacing: { after: twip(10) },
        border: { bottom: hairline },
        children: [new TextRun({ text: fields.join("   "), color: INK, size: halfPt(10) })],
      }),
    );
  }
  out.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { before: twip(8), after: twip(6) },
      children: [
        new TextRun({
          text: header.title || worksheet.title,
          bold: true,
          color: INK,
          size: halfPt(16),
        }),
      ],
    }),
  );
  if (header.subtitle) out.push(plain(header.subtitle, { size: 10.5, after: 6 }));
  for (const criterion of header.criteria ?? []) {
    out.push(plain(`☐  ${criterion}`, { size: 10.5, after: 4 }));
  }
  out.push(plain("", { after: 8 }));
  return out;
}

/** Red / Amber / Green, told apart by their labels, never by colour. */
function ragChildren(): Paragraph[] {
  return [
    new Paragraph({
      text: "",
      spacing: { before: twip(10), after: twip(6) },
      border: { top: hairline },
    }),
    plain("How confident do you feel?", { size: 10.5, after: 4 }),
    plain("◯  Red        ◯  Amber        ◯  Green", { size: 11, after: 6 }),
  ];
}

function answerKeyChildren(worksheet: Worksheet, contentW: number): (Paragraph | Table)[] {
  const entries = answerKey(worksheet.blocks);
  if (entries.length === 0) return [];
  const out: (Paragraph | Table)[] = [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: twip(4) },
      children: [new TextRun({ text: "Answer key", bold: true, color: INK, size: halfPt(16) })],
    }),
    plain(worksheet.header.title || worksheet.title, { size: 10, after: 10 }),
  ];
  for (const entry of entries) {
    const marks = entry.marks ? `  (${entry.marks} ${entry.marks === 1 ? "mark" : "marks"})` : "";
    if (entry.search) {
      out.push(plain(`${entry.number}.${marks}`, { bold: true, after: 4 }));
      out.push(...wordSearchTable(entry.search, true, contentW));
      out.push(plain("", { after: 6 }));
      continue;
    }
    out.push(
      new Paragraph({
        spacing: { after: twip(4) },
        children: [
          new TextRun({ text: `${entry.number}. `, bold: true, color: INK, size: halfPt(10.5) }),
          new TextRun({ text: (entry.lines[0] ?? "") + marks, color: INK, size: halfPt(10.5) }),
        ],
      }),
    );
    for (const line of entry.lines.slice(1)) out.push(plain(line, { size: 10.5, after: 3 }));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

export type DocxOptions = {
  /** Append the answer key on a new page. Defaults to the sheet's own toggle (ADR 0023 §7). */
  includeAnswerKey?: boolean;
  /** The api origin (`${VITE_API_URL}`): image fetches to it carry the session cookie. */
  imageOrigin?: string;
};

export async function buildWorksheetDocx(
  worksheet: Worksheet,
  options: DocxOptions = {},
): Promise<Document> {
  const metrics = pageMetrics(worksheet.pageSize);
  const includeAnswerKey = options.includeAnswerKey ?? worksheet.includeAnswerKey;
  const images = await resolveImages(worksheet, options.imageOrigin);

  const children: (Paragraph | Table)[] = [...headerChildren(worksheet)];
  for (const block of worksheet.blocks)
    children.push(...blockChildren(block, metrics.contentW, images));
  if (worksheet.selfAssessment) children.push(...ragChildren());
  if (includeAnswerKey) children.push(...answerKeyChildren(worksheet, metrics.contentW));

  const section: ISectionOptions = {
    properties: {
      page: {
        size: { width: twip(metrics.page.w), height: twip(metrics.page.h) },
        margin: {
          top: twip(PAGE_PAD),
          right: twip(PAGE_PAD),
          bottom: twip(PAGE_PAD),
          left: twip(PAGE_PAD),
        },
      },
    },
    children,
  };

  return new Document({
    creator: "Teaching Journey",
    title: worksheet.header.title || worksheet.title,
    numbering: {
      config: [{ reference: ORDERED_LIST, levels: orderedLevels }],
    },
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: halfPt(BODY_PT), color: INK },
          paragraph: { spacing: { line: 276, after: twip(4) } },
        },
      },
    },
    sections: [section],
  });
}

/** `${slug}.docx`, the one naming rule every format shares (ADR 0023 §7). */
export const docxFilename = (worksheet: Worksheet): string => `${slugify(worksheet.title)}.docx`;

export async function worksheetDocxBlob(
  worksheet: Worksheet,
  options?: DocxOptions,
): Promise<Blob> {
  return Packer.toBlob(await buildWorksheetDocx(worksheet, options));
}
