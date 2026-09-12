import { describe, expect, test } from "bun:test";
import { PASTE_SECTION } from "./formats/paste";
import { isLowText, isRoster, lineTables, screen } from "./screen";
import { PHOTOSYNTHESIS, ROSTER_ROWS, SCIENTISTS_ROWS, TINY_PNG } from "./testing/fixtures";
import type { Extraction } from "./types";

const base = (over: Partial<Extraction> = {}): Extraction => ({
  kind: "pdf",
  pages: 1,
  chunks: [{ ref: { page: 1 }, text: PHOTOSYNTHESIS.join("\n") }],
  tables: [],
  images: [],
  ...over,
});

describe("isRoster", () => {
  test("names beside dates of birth is a roster; the header row is ignored", () => {
    expect(isRoster(ROSTER_ROWS)).toBe(true);
  });

  test("names beside years is not", () => {
    expect(isRoster(SCIENTISTS_ROWS)).toBe(false);
  });

  test("a single column of five or more full names is a roster, header or not", () => {
    expect(isRoster(ROSTER_ROWS.slice(1).map((r) => [r[0] ?? ""]))).toBe(true);
    // Exactly five, no header: the first row is a name, so it is not dropped.
    expect(isRoster(ROSTER_ROWS.slice(1, 6).map((r) => [r[0] ?? ""]))).toBe(true);
    expect(isRoster([["Name"], ...ROSTER_ROWS.slice(1, 6).map((r) => [r[0] ?? ""])])).toBe(true);
    expect(isRoster(ROSTER_ROWS.slice(1, 4).map((r) => [r[0] ?? ""]))).toBe(false);
  });

  test("names with accents, apostrophes and hyphens count as names", () => {
    const names = [
      "Siobhán O'Neill",
      "Émile Zola",
      "Jean-Luc Picard",
      "Zoë D'Arcy",
      "Ólafur Árnason",
    ];
    expect(isRoster(names.map((n) => [n, "01/02/2014"]))).toBe(true);
    expect(isRoster(names.map((n) => [n]))).toBe(true);
  });

  test("names beside emails, ids, grades or gender tokens are rosters", () => {
    const names = ROSTER_ROWS.slice(1).map((r) => r[0] ?? "");
    for (const attr of ["a.b@school.org", "123456", "B+", "72%", "F"]) {
      expect(isRoster([["Name", "X"], ...names.map((n) => [n, attr])])).toBe(true);
    }
  });

  test("a vocabulary table (single words beside definitions) is not", () => {
    expect(
      isRoster([
        ["Word", "Meaning"],
        ["Chlorophyll", "The green pigment in leaves"],
        ["Stomata", "Pores that let gases in and out"],
        ["Glucose", "A simple sugar plants make"],
        ["Photosynthesis", "Making food from light"],
        ["Oxygen", "The gas plants give off"],
      ]),
    ).toBe(false);
  });

  test("empty tables are not rosters", () => {
    expect(isRoster([])).toBe(false);
    expect(isRoster([["Name"]])).toBe(false);
  });
});

describe("lineTables", () => {
  test("five aligned lines in a PDF page read as a table; prose does not", () => {
    const rows = ROSTER_ROWS.slice(1).map((r) => r.join("   "));
    const text = `Register 5B\n${rows.join("\n")}\nEnd`;
    const tables = lineTables(base({ chunks: [{ ref: { page: 2 }, text }] }));
    expect(tables).toHaveLength(1);
    expect(tables[0]?.ref).toEqual({ page: 2 });
    expect(tables[0]?.rows).toHaveLength(6);
    expect(lineTables(base())).toEqual([]);
  });

  test("only pdf and paste chunks are scanned", () => {
    const text = ROSTER_ROWS.map((r) => r.join("\t")).join("\n");
    expect(lineTables(base({ kind: "docx", chunks: [{ ref: { section: "S" }, text }] }))).toEqual(
      [],
    );
  });
});

describe("screen", () => {
  test("a healthy document passes", () => {
    expect(screen(base())).toBeNull();
  });

  test("too-long wins over everything", () => {
    expect(screen(base({ pages: 301, tables: [{ ref: { page: 1 }, rows: ROSTER_ROWS }] }))).toEqual(
      { reason: "too-long", pages: 301 },
    );
  });

  test("a roster table refuses with its locator", () => {
    expect(screen(base({ tables: [{ ref: { page: 4 }, rows: ROSTER_ROWS }] }))).toEqual({
      reason: "roster",
      ref: { page: 4 },
    });
    expect(screen(base({ tables: [{ ref: { page: 4 }, rows: SCIENTISTS_ROWS }] }))).toBeNull();
  });

  test("a pasted class list is caught through the line-table heuristic", () => {
    const text = ROSTER_ROWS.slice(1)
      .map((r) => r.join("\t"))
      .join("\n");
    expect(
      screen(base({ kind: "paste", chunks: [{ ref: { section: PASTE_SECTION }, text }] })),
    ).toEqual({ reason: "roster", ref: { section: PASTE_SECTION } });
  });

  test("a cast list of single names in prose passes", () => {
    const text = `${PHOTOSYNTHESIS[0]}\nCast: Macbeth, Banquo, Duncan, Macduff, Malcolm and the three witches.`;
    expect(screen(base({ chunks: [{ ref: { page: 1 }, text }] }))).toBeNull();
  });

  test("an identifier anywhere refuses with the first locator and the count", () => {
    const chunks = [
      { ref: { page: 1 }, text: PHOTOSYNTHESIS[0] ?? "" },
      { ref: { page: 2 }, text: "Send your work to j.smith@school.org by Friday." },
      { ref: { page: 3 }, text: "UPN 123456789 is the pupil called Sam." },
    ];
    expect(screen(base({ pages: 3, chunks }))).toEqual({
      reason: "identifiers",
      count: 3,
      ref: { page: 2 },
    });
  });

  test("thin text with no images is unreadable; with an image it passes as lowText", () => {
    const thin = base({
      pages: 3,
      chunks: [{ ref: { page: 1 }, text: "Only thirty characters here." }],
    });
    expect(screen(thin)).toEqual({ reason: "unreadable" });
    expect(isLowText(thin)).toBe(true);
    const withImage = {
      ...thin,
      images: [{ ref: { page: 1 }, mime: "image/png" as const, bytes: TINY_PNG }],
    };
    expect(screen(withImage)).toBeNull();
    expect(isLowText(withImage)).toBe(true);
    expect(isLowText(base())).toBe(false);
  });

  test("average chars per page counts too: 300 chars over 20 pages is thin", () => {
    expect(
      isLowText(base({ pages: 20, chunks: [{ ref: { page: 1 }, text: "x".repeat(300) }] })),
    ).toBe(true);
  });
});
