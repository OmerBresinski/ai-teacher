import { describe, expect, it, mock } from "bun:test";
import { inflateRawSync } from "node:zlib";
import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { Packer } from "docx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { docFromText } from "../model/factories";
import { numberQuestions } from "../model/worksheet-factories";
import { FlowItemContent, SheetHeader } from "../worksheet/BlockContent";
import { sheetHead } from "../worksheet/sheet-head";
import { generateWordSearch } from "../worksheet/word-search";
import { buildWorksheetDocx, decodeImage, docxFilename, resolveImage } from "./docx";

/*
 * TeachDeck `lib/export/__tests__/docx.test.ts` restated (TEACH-112 rows 1–3), plus the fetched
 * image path (TEACH-272 §1). `docx` writes real files under Bun.
 */

/**
 * A .docx is a zip. Reading one entry out of it needs the central directory
 * (jszip writes data descriptors, so the local header's sizes cannot be
 * trusted) and one inflate. Thirty lines beats a test-only dependency.
 */
function readZipEntry(buffer: Buffer, name: string): string {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(-1);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const entryName = buffer.toString("utf8", offset + 46, offset + 46 + nameLen);
    if (entryName === name) {
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const data = buffer.subarray(start, start + compressedSize);
      return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} is not in the file`);
}

function zipEntryNames(buffer: Buffer): string[] {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString("utf8", offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** A 1x1 red PNG, so the image path embeds real bytes. */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const gapId = "gap-1";

function everyBlockSheet(): Worksheet {
  const blocks: WorksheetBlock[] = numberQuestions([
    { id: "b-heading", type: "heading", doc: docFromText("Section one"), level: 1 },
    { id: "b-sub", type: "heading", doc: docFromText("A smaller heading"), level: 2 },
    { id: "b-para", type: "paragraph", doc: docFromText("Read this paragraph before you start.") },
    { id: "b-inst", type: "instructions", doc: docFromText("Answer all of the questions.") },
    {
      id: "b-q",
      type: "question",
      doc: docFromText("Name the process that turns water into vapour."),
      answerLines: 3,
      marks: 2,
      answer: "Evaporation.",
    },
    {
      id: "b-mc",
      type: "multiple-choice",
      doc: docFromText("Which stage comes next?"),
      options: [
        { id: "o1", text: "Evaporation", correct: false },
        { id: "o2", text: "Precipitation", correct: true },
      ],
    },
    {
      id: "b-gap",
      type: "fill-gap",
      doc: docFromText(`The water [[gap:${gapId}]] into the air.`),
      gaps: [{ id: gapId, answer: "evaporates" }],
    },
    {
      id: "b-match",
      type: "matching",
      pairs: [
        { id: "p1", left: "Evaporation", right: "Liquid becomes gas" },
        { id: "p2", left: "Condensation", right: "Gas becomes liquid" },
      ],
    },
    {
      id: "b-search",
      type: "word-search",
      words: ["water", "cloud", "river", "rain"],
      size: 10,
      directions: "all",
      seed: 4,
      showWordBank: true,
    },
    { id: "b-bank", type: "word-bank", words: ["evaporates", "condenses"] },
    { id: "b-box", type: "answer-box", heightPt: 120, label: "Show your working" },
    { id: "b-lines", type: "lines", count: 4 },
    {
      id: "b-image",
      type: "image",
      src: PNG_1X1,
      alt: "A cloud",
      widthPct: 50,
      caption: "Figure 1",
    },
    { id: "b-remote", type: "image", src: "https://example.com/cloud.png", widthPct: 40 },
    {
      id: "b-table",
      type: "table",
      rows: [
        ["Stage", "What happens"],
        ["Evaporation", ""],
      ],
      header: true,
    },
    { id: "b-divider", type: "divider" },
    { id: "b-break", type: "page-break" },
  ]);

  return {
    version: 1,
    id: "ws-every-block",
    title: "Every block",
    themeId: "splash",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    header: {
      showName: true,
      showDate: true,
      showClass: true,
      title: "The water cycle: check your understanding",
      subtitle: "I can explain how water moves around.",
      criteria: ["I can name each stage", "I can explain condensation"],
    },
    blocks,
    includeAnswerKey: true,
    pageSize: "A4",
    selfAssessment: true,
  };
}

/**
 * The every-block sheet carries one remote picture (`https://example.com/cloud.png`) so the
 * "left out" line is exercised; its fetch is answered here with a 404, so no test touches the
 * network.
 */
async function withOfflineFetch<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

async function xmlFor(
  worksheet: Worksheet,
): Promise<{ xml: string; buffer: Buffer; names: string[] }> {
  const buffer = await withOfflineFetch(async () =>
    // These tests say "key or not" with the sheet's flag: on is both parts, off the pupil sheet.
    // The export's own default (the pupil sheet) has its own test below.
    Packer.toBuffer(
      await buildWorksheetDocx(worksheet, {
        part: worksheet.includeAnswerKey === false ? "pupil" : "both",
      }),
    ),
  );
  const node = Buffer.from(buffer);
  return { xml: readZipEntry(node, "word/document.xml"), buffer: node, names: zipEntryNames(node) };
}

describe("worksheet Word export", () => {
  it("writes a Word file with the parts Word needs", async () => {
    const { names } = await xmlFor(everyBlockSheet());
    expect(names).toContain("[Content_Types].xml");
    expect(names).toContain("word/document.xml");
  });

  it("carries the title, the header lines and the objective (strip off; on, the strip has them)", async () => {
    const { xml } = await xmlFor({ ...everyBlockSheet(), selfAssessment: false });
    expect(xml).toContain("The water cycle: check your understanding");
    expect(xml).toContain("Name:");
    expect(xml).toContain("Date:");
    expect(xml).toContain("Class:");
    expect(xml).toContain("I can explain how water moves around.");
    // With the strip off the criteria are header lines, not checkbox lines.
    expect(xml).toContain("I can name each stage");
    expect(xml).not.toContain("☐  I can name each stage");
    const withStrip = await xmlFor(everyBlockSheet());
    expect(withStrip.xml).toContain("☐  I can name each stage");
    expect(withStrip.xml).not.toContain("I can explain how water moves around.");
  });

  it("lays the page out at the sheet size", async () => {
    // 595 x 842pt and 612 x 792pt, in the twentieths of a point Word measures in.
    const a4 = await xmlFor(everyBlockSheet());
    expect(a4.xml).toContain('w:w="11900"');
    expect(a4.xml).toContain('w:h="16840"');
    const letter = await xmlFor({ ...everyBlockSheet(), pageSize: "Letter" });
    expect(letter.xml).toContain('w:w="12240"');
    expect(letter.xml).toContain('w:h="15840"');
  });

  it("writes every block type as real text", async () => {
    const { xml } = await xmlFor(everyBlockSheet());
    expect(xml).toContain("Section one");
    expect(xml).toContain("Read this paragraph before you start.");
    expect(xml).toContain("Answer all of the questions.");
    expect(xml).toContain("(2 marks)");
    // Lettered options with a box to tick.
    expect(xml).toContain("☐  A  Evaporation");
    expect(xml).toContain("☐  B  Precipitation");
    // The gap is a blank as wide as the longest answer in its run.
    expect(xml).toContain("______________");
    expect(xml).toContain("Liquid becomes gas");
    expect(xml).toContain("Show your working");
    expect(xml).toContain("Figure 1");
    expect(xml).toContain("What happens");
    // A page break block, and the answer key's own break.
    expect(xml).toContain('w:type="page"');
  });

  it("gives every blank in a run of fill-gap sentences the run's longest answer", async () => {
    const sentence = (id: string, answer: string, rest: string): WorksheetBlock => ({
      id,
      type: "fill-gap",
      doc: docFromText(`[[gap:${id}-g]] ${rest}`),
      gaps: [{ id: `${id}-g`, answer }],
    });
    const { xml } = await xmlFor({
      ...everyBlockSheet(),
      includeAnswerKey: false,
      blocks: numberQuestions([
        { id: "bank", type: "word-bank", words: ["Large language model (LLM)", "Token"] },
        sentence("s1", "Large language model (LLM)", "is an AI system."),
        sentence("s2", "Token", "is a chunk of text."),
      ]),
    });
    // 26 characters and four to spare, on the short answer's line as on the long one's.
    const blankBefore = (rest: string) => xml.match(new RegExp(`(_+) ${rest}`))?.[1];
    expect(blankBefore("is an AI system\\.")).toBe("_".repeat(30));
    expect(blankBefore("is a chunk of text\\.")).toBe("_".repeat(30));
  });

  it("writes the word search as a table of single letters with its word bank", async () => {
    // Without the key, so the count is the sheet's own grid and nothing else.
    const { xml } = await xmlFor({ ...everyBlockSheet(), includeAnswerKey: false });
    expect(xml).toContain("<w:tbl>");
    // Only the word search sets a mono face, so this ties a table to the grid.
    const letters = xml.match(/w:ascii="Consolas"/g) ?? [];
    expect(letters.length).toBe(100); // a 10x10 grid, one cell per letter
    expect(xml).toContain("WATER");
    expect(xml).toContain("Find every word. They run in any direction, including backwards.");
  });

  it("embeds a data-URL image and says when one is left out", async () => {
    const { xml, names } = await xmlFor(everyBlockSheet());
    expect(names.some((name) => name.startsWith("word/media/"))).toBe(true);
    // The remote picture is fetched now (TEACH-272 §1); an unreachable one is left out.
    expect(xml).toContain("Image left out: it could not be fetched.");
  });

  it("adds the self-assessment strip and the answer key on a new page", async () => {
    const { xml } = await xmlFor(everyBlockSheet());
    expect(xml).toContain("How confident do you feel?");
    expect(xml).toContain("◯  Red");
    expect(xml).toContain("Answer key");
    expect(xml).toContain("Evaporation.");
    expect(xml).toContain("The answers are the letters in bold and underlined.");
  });

  it("underlines the answer letters as well as bolding them", async () => {
    // The sheet's own grid carries no underline; the key's answers do.
    const plainGrid = await xmlFor({ ...everyBlockSheet(), includeAnswerKey: false });
    expect(plainGrid.xml).not.toContain("<w:u ");
    const withKey = await xmlFor(everyBlockSheet());
    expect(withKey.xml).toContain("<w:u ");
  });

  it("numbers an ordered list", async () => {
    const sheet = everyBlockSheet();
    const ordered: WorksheetBlock = {
      id: "b-ordered",
      type: "paragraph",
      doc: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Fill the beaker." }] },
                ],
              },
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Heat the water." }] },
                ],
              },
            ],
          },
        ],
      },
    };
    const { xml, names } = await xmlFor({ ...sheet, blocks: [...sheet.blocks, ordered] });
    // The definition Word needs, and a paragraph that points at it.
    expect(names).toContain("word/numbering.xml");
    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain("Heat the water.");
  });

  it("leaves the answer key out when the sheet has it off", async () => {
    const { xml } = await xmlFor({ ...everyBlockSheet(), includeAnswerKey: false });
    expect(xml).not.toContain("Answer key");
  });

  it("names the file after the sheet, slugged like every other format (ADR 0023 §7)", () => {
    const sheet = everyBlockSheet();
    expect(docxFilename(sheet)).toBe("every-block.docx");
    expect(docxFilename({ ...sheet, title: "Fractions practice" })).toBe("fractions-practice.docx");
  });

  it("decodes the image formats Word can embed and refuses the rest", () => {
    const png = decodeImage(PNG_1X1);
    expect(png?.type).toBe("png");
    expect(png).toMatchObject({ width: 1, height: 1 });
    expect(decodeImage("https://example.com/a.png")).toBeNull();
    expect(decodeImage("data:image/svg+xml;base64,PHN2Zy8+")).toBeNull();
  });

  it("refuses a data URL whose base64 does not decode, without throwing", () => {
    expect(decodeImage("data:image/png;base64,%%%not-base64%%%")).toBeNull();
  });

  it("refuses an image whose size cannot be read rather than guessing one", () => {
    // A PNG signature and nothing else: the width and height are not there.
    const stub = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    expect(decodeImage(`data:image/png;base64,${stub}`)).toBeNull();
  });

  it("says an unreadable image was left out instead of stretching it", async () => {
    const sheet = everyBlockSheet();
    const stub = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    const broken: WorksheetBlock = {
      id: "b-broken",
      type: "image",
      src: `data:image/png;base64,${stub}`,
      widthPct: 50,
    };
    const { xml } = await xmlFor({ ...sheet, blocks: [...sheet.blocks, broken] });
    expect(xml).toContain("Image left out: the file could not be read.");
  });

  it("banks only the words the grid actually holds", async () => {
    const sheet = everyBlockSheet();
    const search: WorksheetBlock = {
      id: "b-tight",
      type: "word-search",
      // Nine eight-letter words cannot all fit an 8x8 grid running one way.
      words: [
        "aaaaaaaa",
        "bbbbbbbb",
        "cccccccc",
        "dddddddd",
        "eeeeeeee",
        "ffffffff",
        "gggggggg",
        "hhhhhhhh",
        "iiiiiiii",
      ],
      size: 8,
      directions: "across-down",
      seed: 2,
      showWordBank: true,
    };
    const { xml } = await xmlFor({ ...sheet, blocks: [search], includeAnswerKey: false });
    const grid = generateWordSearch({
      words: search.words,
      size: 8,
      directions: "across-down",
      seed: 2,
    });
    expect(grid.unplaced.length).toBeGreaterThan(0);
    // The bank line is one paragraph of the placed words, four spaces apart.
    expect(xml).toContain(grid.placements.map((p) => p.word).join("    "));
    for (const word of grid.unplaced) {
      expect(xml).not.toContain(`${word}    `);
    }
  });
});

describe("resolveImage (TEACH-272 §1)", () => {
  const pngBytes = Buffer.from(PNG_1X1.split(",")[1] ?? "", "base64");

  it("decodes a data URL without touching the network", async () => {
    const original = globalThis.fetch;
    const fetchSpy = mock(async () => new Response("never"));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      expect(await resolveImage(PNG_1X1, "https://api.test")).toMatchObject({
        type: "png",
        width: 1,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("fetches an api-origin picture with the cookie and a foreign one without", async () => {
    const original = globalThis.fetch;
    const calls: RequestInit[] = [];
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(pngBytes, { headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
    try {
      const ours = await resolveImage("https://api.test/files/ws/a.png", "https://api.test");
      expect(ours).toMatchObject({ type: "png", width: 1, height: 1 });
      expect(calls[0]?.credentials).toBe("include");
      await resolveImage("https://elsewhere.test/a.png", "https://api.test");
      expect(calls[1]?.credentials).toBe("omit");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("resolves a relative /files/ path against the origin and sends the cookie (TEACH-275)", async () => {
    const original = globalThis.fetch;
    const calls: [string, RequestInit | undefined][] = [];
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(pngBytes, { headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
    try {
      expect(await resolveImage("/files/ws/a.png", "https://api.test")).toMatchObject({
        type: "png",
      });
      expect(calls[0]?.[0]).toBe("https://api.test/files/ws/a.png");
      expect(calls[0]?.[1]?.credentials).toBe("include");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("is null for a failed fetch, an unknown type, or a src that is not a URL", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(async (url: string) =>
      url.endsWith("404")
        ? new Response(null, { status: 404 })
        : new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
    ) as unknown as typeof fetch;
    try {
      expect(await resolveImage("https://api.test/files/404", "https://api.test")).toBeNull();
      expect(await resolveImage("https://api.test/files/a.svg", "https://api.test")).toBeNull();
      expect(await resolveImage("not a url", "https://api.test")).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});

/* T3: one header rule for print and Word. */

const decode = (text: string) =>
  text
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");

/** The words Word shows, one entry per paragraph, in reading order. */
function wordLines(xml: string): string[] {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((p) => [...p[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""))
    .map((line) => decode(line).trim())
    .filter((line) => line !== "");
}

/** The words the print route shows for the header and the self-assessment strip, in order. */
function printLines(worksheet: Worksheet): string[] {
  const html = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement(SheetHeader, { worksheet }),
      worksheet.selfAssessment
        ? createElement(FlowItemContent, { item: { kind: "rag" }, worksheet, mode: "print" })
        : null,
    ),
  );
  return html
    .split(/<(?:h1|p|li|div)[^>]*>/)
    .map((chunk) => decode(chunk.replace(/<[^>]+>/g, "")).trim())
    .filter((line) => line !== "");
}

function headSheet(overrides: Partial<Worksheet["header"]> = {}, selfAssessment = true): Worksheet {
  return {
    ...everyBlockSheet(),
    blocks: [],
    includeAnswerKey: false,
    selfAssessment,
    header: {
      showName: false,
      showDate: false,
      showClass: false,
      title: "Rivers: erosion and deposition",
      subtitle: "To explain how a meander forms.",
      criteria: [
        "I can name the inner and outer bank",
        "",
        "I can explain where erosion happens",
        "I can explain where deposition happens",
        "I can draw a meander",
        "I can name an ox-bow lake",
      ],
      ...overrides,
    },
  };
}

describe("header rule: print and Word match (worksheets plan T3)", () => {
  it("with the strip on: the title alone in the header, the criteria ticked in the strip", async () => {
    const sheet = headSheet();
    const head = sheetHead(sheet);
    expect(head.objective).toBeUndefined();
    expect(head.moreObjectives).toEqual([]);
    const expected = [
      head.title,
      "Tick what you can do now",
      ...head.criteria,
      "How confident do you feel?",
    ];
    const word = wordLines((await xmlFor(sheet)).xml).map((line) => line.replace(/^☐\s+/, ""));
    const print = printLines(sheet);
    const pick = (lines: string[]) => lines.filter((line) => expected.includes(line));
    expect(pick(word)).toEqual(expected as string[]);
    expect(pick(print)).toEqual(expected as string[]);
    for (const lines of [word, print]) {
      expect(lines).not.toContain("To explain how a meander forms.");
      expect(lines.join("\n")).not.toContain("ox-bow");
      expect(lines.filter((line) => line === "I can draw a meander")).toHaveLength(1);
    }
  });

  it("prints no tick boxes in either when the self-assessment strip is off, but still the objectives", async () => {
    const sheet = headSheet({}, false);
    const word = wordLines((await xmlFor(sheet)).xml);
    const print = printLines(sheet);
    for (const lines of [word, print]) {
      expect(lines).toContain("Rivers: erosion and deposition");
      expect(lines).toContain("To explain how a meander forms.");
      expect(lines.join("\n")).not.toContain("Tick what you can do now");
      expect(lines.join("\n")).not.toContain("☐");
      expect(lines.filter((line) => line === "I can name the inner and outer bank")).toHaveLength(
        1,
      );
    }
  });

  it("falls back to the document title in both when the header has none", async () => {
    const sheet = { ...headSheet({ title: "" }), title: "Rivers sheet" };
    expect(wordLines((await xmlFor(sheet)).xml)[0]).toBe("Rivers sheet");
    expect(printLines(sheet)[0]).toBe("Rivers sheet");
  });
});

describe("what the Word file carries (WS8)", () => {
  it("is the pupil sheet alone by default, whatever the sheet's own switch says", async () => {
    const sheet = { ...headSheet(), includeAnswerKey: true };
    const buffer = Buffer.from(await Packer.toBuffer(await buildWorksheetDocx(sheet)));
    const xml = readZipEntry(buffer, "word/document.xml");
    expect(xml).not.toContain("Answer key");
    expect(xml).not.toContain("Teacher copy");
  });

  it("the answer key alone starts with Teacher copy, with no name line and no page break first", async () => {
    const sheet = everyBlockSheet();
    const buffer = Buffer.from(
      await Packer.toBuffer(await buildWorksheetDocx(sheet, { part: "key" })),
    );
    const xml = readZipEntry(buffer, "word/document.xml");
    const lines = wordLines(xml);
    expect(lines[0]).toBe("Teacher copy");
    expect(lines).toContain("Answer key");
    expect(xml).not.toContain("Name:");
    expect(xml).not.toContain('w:type="page"');
  });
});
