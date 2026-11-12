import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { Packer } from "docx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildWorksheetDocx } from "../export/docx";
import { docFromText } from "../model/factories";
import { getTheme } from "../model/themes";
import { plainLineHTML } from "../text/serialize";
import { renderDocHTML } from "../text/static";
import { FlowItemContent } from "./BlockContent";
import { CONTENT_H } from "./metrics";
import { blockKeepsWithNext, buildFlow, type FlowItem, paginate, splitLines } from "./paginate";
import { sheetVars } from "./Sheet";
import { sheetHead } from "./sheet-head";
import { SHEET_SIZES, sheetBand, sheetSizes } from "./sheet-sizes";

/*
 * WS8: what the 11 Nov Y5 Practice sheet got wrong on paper and in Word. Fractions printed flat,
 * question 5 sat at the foot of page 1 with its working box on page 2, and the self-assessment
 * strip was pinned to the foot of page 2 under a tall empty band.
 */

const q = (
  id: string,
  text: string,
  number: number,
  answer = "5 (20 ÷ 4 = 5)",
): WorksheetBlock => ({
  id,
  type: "question",
  doc: docFromText(text),
  answerLines: 0,
  answer,
  number,
});
const box = (id: string): WorksheetBlock => ({
  id,
  type: "answer-box",
  heightPt: 48,
  label: "Working and answer",
});
const heading = (id: string): WorksheetBlock => ({
  id,
  type: "heading",
  doc: docFromText("Practice"),
  level: 2,
});
const instructions = (id: string): WorksheetBlock => ({
  id,
  type: "instructions",
  doc: docFromText("Answer each question."),
});
const para = (id: string): WorksheetBlock => ({ id, type: "paragraph", doc: docFromText(id) });

const flow = (blocks: WorksheetBlock[]): FlowItem[] =>
  blocks.map((b) => ({ key: b.id, kind: "block" as const, block: b }));
const keys = (items: FlowItem[] | undefined) => (items ?? []).map((i) => i.key);

function sheet(blocks: WorksheetBlock[]): Worksheet {
  return {
    version: 1,
    id: "ws8",
    title: "Fractions of amounts",
    themeId: "studio",
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    header: { showName: true, showDate: true, showClass: true, title: "Fractions of amounts" },
    blocks,
    includeAnswerKey: true,
    pageSize: "A4",
    selfAssessment: false,
  } as Worksheet;
}

describe("a question stays with its answer space", () => {
  test("the rule: a question keeps with its box or lines; a heading and instructions with what follows", () => {
    expect(blockKeepsWithNext(q("a", "Q", 1), box("b"))).toBe(true);
    expect(blockKeepsWithNext(q("a", "Q", 1), { id: "l", type: "lines", count: 3 })).toBe(true);
    expect(blockKeepsWithNext(q("a", "Q", 1), q("c", "Q", 2))).toBe(false);
    expect(blockKeepsWithNext(box("b"), q("c", "Q", 2))).toBe(false);
    expect(blockKeepsWithNext(heading("h"), instructions("i"))).toBe(true);
    expect(blockKeepsWithNext(instructions("i"), q("c", "Q", 1))).toBe(true);
    expect(blockKeepsWithNext(heading("h"), { id: "pb", type: "page-break" })).toBe(false);
    expect(blockKeepsWithNext(heading("h"), undefined)).toBe(false);
  });

  test("question 5 moves to page 2 with its box instead of leaving the box behind (the Y5 sheet)", () => {
    // Room for the filler and the question but not the box.
    const items = flow([para("filler"), q("q5", "A tray holds 40 counters.", 5), box("box5")]);
    const heights = { filler: CONTENT_H - 60, q5: 30, box5: 70 };
    const { pages, oversize } = paginate(items, heights, 0);
    expect(keys(pages[0]?.items)).toEqual(["filler"]);
    expect(keys(pages[1]?.items)).toEqual(["q5", "box5"]);
    expect(oversize).toEqual([]);
  });

  test("a heading, its instructions and the first question with its box move together", () => {
    const items = flow([
      para("filler"),
      heading("h"),
      instructions("i"),
      q("q1", "Q", 1),
      box("b1"),
    ]);
    const heights = { filler: CONTENT_H - 120, h: 30, i: 20, q1: 30, b1: 70 };
    const { pages } = paginate(items, heights, 0);
    expect(keys(pages[0]?.items)).toEqual(["filler"]);
    expect(keys(pages[1]?.items)).toEqual(["h", "i", "q1", "b1"]);
  });

  test("a run that fits keeps its page; a run taller than a page splits as before, never a blank page", () => {
    const fits = paginate(
      flow([para("filler"), q("q", "Q", 1), box("b")]),
      { filler: 100, q: 30, b: 70 },
      0,
    );
    expect(fits.pages).toHaveLength(1);
    const tall = paginate(
      flow([para("filler"), q("q", "Q", 1), box("b")]),
      { filler: 200, q: 30, b: CONTENT_H },
      0,
    );
    expect(keys(tall.pages[0]?.items)).toEqual(["filler", "q"]);
    expect(keys(tall.pages[1]?.items)).toEqual(["b"]);
  });

  test("Word keeps the question, the box label and the box on one page (keep with next, rows unsplit)", async () => {
    const xml = await documentXml(
      sheet([q("q1", "What is 1/4 of 20?", 1), box("b1"), q("q2", "Next", 2)]),
    );
    const body = xml.slice(xml.indexOf("<w:body>"));
    const paras = body.split("<w:p>").slice(1);
    const stem = paras.find((p) => p.includes("What is"));
    expect(stem).toContain("<w:keepNext/>");
    const label = paras.find((p) => p.includes("Working and answer"));
    expect(label).toContain("<w:keepNext/>");
    expect(xml).toContain("<w:cantSplit/>");
    // The box does not keep with question 2: the next question may start a new page.
    const next = paras.find((p) => p.includes("Next"));
    expect(next).toBeDefined();
  });
});

describe("fractions on the sheet are stacked, by the slides' finder", () => {
  test("the print view's question stem carries the stacked markup", () => {
    const html = renderDocHTML(docFromText("What is 1/4 of 20?"));
    expect(html).toContain('<span class="td-frac"><span class="td-frac-num">1</span>');
    expect(html).toContain('<span class="td-frac-den">4</span>');
  });

  test("the sheet's styles draw it: worksheet.css imports the shared fraction rules, set tall", () => {
    const css = readFileSync(new URL("../styles/worksheet.css", import.meta.url), "utf8");
    expect(css).toContain('@import "./fractions.css";');
    expect(css).toMatch(/\.ws-sheet \{[^}]*--td-frac: 1;/);
    const shared = readFileSync(new URL("../styles/fractions.css", import.meta.url), "utf8");
    expect(shared).toContain(".td-frac {");
    const slide = readFileSync(new URL("../styles/slide.css", import.meta.url), "utf8");
    expect(slide).toContain('@import "./fractions.css";');
    expect(slide).not.toContain(".td-frac {");
  });

  test("an answer-key line stacks its fractions and stays escaped", () => {
    expect(plainLineHTML("3/4 of 20 = 15")).toContain('class="td-frac"');
    expect(plainLineHTML("Open 24/7 & <late>")).toBe("Open 24/7 &amp; &lt;late&gt;");
    expect(plainLineHTML("")).toBe("");
    const entry = renderToStaticMarkup(
      createElement(FlowItemContent, {
        item: {
          kind: "key-entry",
          entry: { id: "q1", number: 1, lines: ["15 (3/4 of 20 = 15)"] },
        },
        worksheet: sheet([]),
        mode: "print",
      }),
    );
    expect(entry).toContain('class="ws-key-line">15 (<span class="td-frac">');
  });

  test("Word draws a real stacked fraction (an equation m:f) in the stem and in the key", async () => {
    const xml = await documentXml(sheet([q("q1", "What is 1/4 of 20?", 1, "6 (2/5 of 15 = 6)")]));
    const fractions = xml.match(/<m:f>/g) ?? [];
    expect(fractions).toHaveLength(2);
    expect(xml).toMatch(/<m:num>.*?<m:t[^>]*>1<\/m:t>.*?<\/m:num>/);
    expect(xml).toMatch(/<m:den>.*?<m:t[^>]*>4<\/m:t>.*?<\/m:den>/);
    expect(xml).toContain("What is ");
    expect(xml).toContain(" of 20?");
    // Not maths by the shared finder (no operator, no "of"): it stays a slash, as on a slide.
    const flat = await documentXml(sheet([q("q1", "Open 24/7.", 1)]));
    expect(flat).not.toContain("<m:f>");
  });
});

describe("the self-assessment strip flows after the last question", () => {
  test("no longer pinned to the foot of its page", () => {
    const css = readFileSync(new URL("../styles/worksheet.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/\.ws-rag-slot\s*\{[^}]*position:\s*absolute/);
  });

  test("it follows the questions on the same page when it fits", () => {
    const ws = {
      ...sheet([q("q1", "Q", 1), box("b1")]),
      selfAssessment: true,
      includeAnswerKey: false,
    };
    const items = buildFlow(ws, false);
    const { pages } = paginate(items, { q1: 30, b1: 70, __rag__: 120 }, 100);
    expect(pages).toHaveLength(1);
    expect(keys(pages[0]?.items)).toEqual(["q1", "b1", "__rag__"]);
  });
});

function readZipEntry(buffer: Buffer, name: string): string {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    if (buffer.toString("utf8", offset + 46, offset + 46 + nameLen) === name) {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + size);
      return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} is not in the file`);
}

async function documentXml(worksheet: Worksheet): Promise<string> {
  const buffer = Buffer.from(
    await Packer.toBuffer(await buildWorksheetDocx(worksheet, { part: "both" })),
  );
  return readZipEntry(buffer, "word/document.xml");
}

describe("round 2: sizes by year band", () => {
  test("one table: Reception to Year 2 large, Years 3 to 6 between, secondary as it was", () => {
    expect(sheetBand({ yearGroup: "Year 2" })).toBe("ks1");
    expect(sheetBand({ yearGroup: "Reception" })).toBe("ks1");
    expect(sheetBand({ yearGroup: "Year 5" })).toBe("ks2");
    expect(sheetBand({ yearGroup: "Year 8" })).toBe("secondary");
    expect(sheetBand({ ageBand: "ks1" } as never)).toBe("ks1");
    expect(sheetBand({})).toBe("secondary");
    // Year 2 question text 11pt x 1.5 = 16.5pt; handwriting lines 15mm (42.52pt).
    expect(11 * SHEET_SIZES.ks1.type).toBeCloseTo(16.5);
    expect(SHEET_SIZES.ks1.lineGapPt).toBeCloseTo(42.52, 1);
    expect(SHEET_SIZES.ks2.type).toBeGreaterThan(SHEET_SIZES.secondary.type);
    expect(SHEET_SIZES.ks2.type).toBeLessThan(SHEET_SIZES.ks1.type);
  });

  test("print and the editor page view read it through sheetVars; the CSS scales every type size", () => {
    const vars = sheetVars(getTheme("studio"), "A4", sheetSizes({ yearGroup: "Year 1" })) as Record<
      string,
      string
    >;
    expect(vars["--ws-type"]).toBe("1.5");
    expect(vars["--ws-line-gap"]).toBe(`${SHEET_SIZES.ks1.lineGapPt}pt`);
    expect(vars["--ws-box"]).toBe("1.6");
    const css = readFileSync(new URL("../styles/worksheet.css", import.meta.url), "utf8");
    // Only the footer keeps a fixed size.
    expect(css.match(/font-size: \d+(\.\d+)?pt;/g)).toHaveLength(1);
  });

  test("Word reads the same table: a Year 2 stem is 16.5pt and its lines 15mm apart", async () => {
    const xml = await documentXml({
      ...sheet([{ ...q("q1", "Why did the fire spread?", 1), answerLines: 2 } as WorksheetBlock]),
      yearGroup: "Year 2",
    });
    expect(xml).toContain('<w:sz w:val="33"/>');
    expect(xml).toContain(`w:before="${Math.round((SHEET_SIZES.ks1.lineGapPt - 6) * 20)}"`);
  });
});

describe("round 2: a stacked fraction reads at close to body size", () => {
  test("on a sheet the parts are 0.9em and the line grows", () => {
    const css = readFileSync(new URL("../styles/worksheet.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.ws-sheet \.td-frac \{[^}]*height: 2\.1em/);
    expect(css).toMatch(/\.ws-sheet \.td-frac-den \{[^}]*font-size: 0\.9em/);
  });
});

describe("round 2: every objective in the header", () => {
  test("the objective line, then the other criteria, four in all, none repeated", () => {
    const ws = sheet([]);
    ws.header = {
      ...ws.header,
      subtitle: "I can find a unit fraction.",
      criteria: [
        "I can find a unit fraction.",
        "I can find a non-unit fraction.",
        "I can solve a problem.",
        "I can explain.",
        "I can check.",
      ],
    };
    expect(sheetHead(ws).moreObjectives).toEqual([
      "I can find a non-unit fraction.",
      "I can solve a problem.",
      "I can explain.",
    ]);
  });
});

describe("round 2: a lines question splits rather than leave a third of a page empty", () => {
  const long = { ...q("q9", "Explain how the fire spread.", 9), answerLines: 6 } as WorksheetBlock;
  const item: FlowItem = { key: "q9", kind: "block", block: long };
  const gap = 25;
  const height = 30 + 6 * gap; // text 30pt + 6 lines

  test("splits after the text with at least two lines each side when the gap would be over a third", () => {
    const left = CONTENT_H / 3 + 10;
    const split = splitLines(item, height, left, CONTENT_H, gap);
    expect(split).not.toBeNull();
    const head = split?.head as Extract<FlowItem, { kind: "block" }>;
    const tail = split?.tail as Extract<FlowItem, { kind: "block" }>;
    expect(head.split).toBe("head");
    expect(tail.split).toBe("tail");
    const hl = (head.block as { answerLines: number }).answerLines;
    const tl = (tail.block as { answerLines: number }).answerLines;
    expect(hl + tl).toBe(6);
    expect(hl).toBeGreaterThanOrEqual(2);
    expect(tl).toBeGreaterThanOrEqual(2);
    expect(split?.headH ?? 0).toBeLessThanOrEqual(left);
  });

  test("moves whole when the gap is small, when it has under four lines, or when it has a box", () => {
    expect(splitLines(item, height, CONTENT_H / 4, CONTENT_H, gap)).toBeNull();
    const short: FlowItem = {
      key: "s",
      kind: "block",
      block: { ...long, answerLines: 3 } as WorksheetBlock,
    };
    expect(splitLines(short, 30 + 3 * gap, CONTENT_H / 2, CONTENT_H, gap)).toBeNull();
    const boxed: FlowItem = { key: "b", kind: "block", block: box("b") };
    expect(splitLines(boxed, 70, CONTENT_H / 2, CONTENT_H, gap)).toBeNull();
  });

  test("paginate puts the head on this page and the rest of the lines on the next", () => {
    const tall = { ...long, answerLines: 12 } as WorksheetBlock; // 330pt: more than the room left
    const items = flow([para("filler"), tall]);
    const filler = CONTENT_H - CONTENT_H / 3 - 60; // leaves a third of the page and 60pt
    const { pages } = paginate(items, { filler, q9: 30 + 12 * gap }, 0, CONTENT_H, gap);
    expect(keys(pages[0]?.items)).toEqual(["filler", "q9#head"]);
    expect(keys(pages[1]?.items)).toEqual(["q9#tail"]);
    const tail = renderToStaticMarkup(
      createElement(FlowItemContent, {
        item: pages[1]?.items[0] as FlowItem,
        worksheet: sheet([]),
        mode: "print",
      }),
    );
    expect(tail).not.toContain("Explain how the fire spread.");
    expect(tail).toContain("ws-line");
  });
});
