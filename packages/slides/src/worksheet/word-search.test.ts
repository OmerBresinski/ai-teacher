import { describe, expect, test } from "bun:test";
import { WORD_SEARCH_MAX_SIZE, WORD_SEARCH_MIN_SIZE } from "@tj/domain/documents";
import {
  buildWordSearch,
  clampSize,
  directionVectors,
  findWord,
  generateWordSearch,
  normaliseWordList,
  normaliseWords,
  rejectedMessage,
  solutionMask,
  textToWords,
  unfittableMessage,
  WORD_SEARCH_DEFAULT_SIZE,
  type WordSearchDirections,
  type WordSearchGrid,
  wordOccurrences,
  wordSearchLead,
  wordSearchProblems,
  wordsToText,
} from "./word-search";

const WORDS = ["water", "cloud", "river", "rain", "ocean", "vapour"];

const allowed = (directions: WordSearchDirections) =>
  directionVectors(directions).map(([dRow, dCol]) => `${dRow},${dCol}`);

const cell = (grid: WordSearchGrid, row: number, col: number) => grid.rows[row]?.[col];

describe("generateWordSearch", () => {
  test("is deterministic for the same seed and different for another", () => {
    const a = generateWordSearch({ words: WORDS, size: 12, directions: "all", seed: 7 });
    const b = generateWordSearch({ words: WORDS, size: 12, directions: "all", seed: 7 });
    const c = generateWordSearch({ words: WORDS, size: 12, directions: "all", seed: 8 });
    expect(a.rows).toEqual(b.rows);
    expect(a.placements).toEqual(b.placements);
    expect(c.rows).not.toEqual(a.rows);
  });

  test("fills every cell with a single capital", () => {
    const grid = generateWordSearch({ words: WORDS, size: 10, seed: 3 });
    expect(grid.rows).toHaveLength(10);
    for (const row of grid.rows) {
      expect(row).toHaveLength(10);
      for (const letter of row) expect(letter).toMatch(/^[A-Z]$/);
    }
  });

  test("places every word across and down only, or in any of the eight directions", () => {
    for (const directions of ["across-down", "all"] as const) {
      const grid = generateWordSearch({ words: WORDS, size: 12, directions, seed: 42 });
      expect(grid.unplaced).toEqual([]);
      for (const word of normaliseWords(WORDS)) {
        const found = findWord(grid, word);
        expect(found, `${word} is not in the grid`).not.toBeNull();
        expect(allowed(directions)).toContain(`${found?.dRow},${found?.dCol}`);
      }
    }
  });

  test("reports every placement at the cells the word occupies; the mask covers them", () => {
    const grid = generateWordSearch({ words: WORDS, size: 12, directions: "all", seed: 5 });
    for (const p of grid.placements) {
      for (let i = 0; i < p.word.length; i++) {
        expect(cell(grid, p.row + p.dRow * i, p.col + p.dCol * i)).toBe(p.word[i]);
      }
    }
    const marked = solutionMask(grid).flat().filter(Boolean).length;
    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThanOrEqual(grid.placements.reduce((n, p) => n + p.word.length, 0));
  });

  test("throws when a word is longer than the grid, naming every offender as typed", () => {
    expect(() => generateWordSearch({ words: ["condensation"], size: 8, seed: 1 })).toThrow(
      /“condensation” is 12 letters and the grid is 8 across/,
    );
    let message = "";
    try {
      generateWordSearch({ words: ["rain", "condensation", "precipitation"], size: 8, seed: 1 });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("“condensation” and “precipitation”");
    expect(message).toContain("Make the grid bigger or the words shorter.");
    expect(message).not.toContain("rain");

    const result = buildWordSearch({
      words: ["condensation"],
      size: 8,
      directions: "all",
      seed: 1,
    });
    expect(result.grid).toBeNull();
    expect(result.error).toMatch(/Make the grid bigger or the word shorter/);
  });

  test("normalises words, strips accents, reports emptied words and clamps the size 8–15", () => {
    expect(normaliseWords(["Water cycle", "water-cycle", "  ", "rain!"])).toEqual([
      "WATERCYCLE",
      "RAIN",
    ]);
    expect(normaliseWords(["café", "Éire", "noël"])).toEqual(["CAFE", "EIRE", "NOEL"]);
    const { entries, rejected } = normaliseWordList(["rain", "???", "   ", "…"]);
    expect(entries.map((e) => e.word)).toEqual(["RAIN"]);
    expect(rejected).toEqual(["???", "…"]);
    expect(generateWordSearch({ words: ["rain", "???"], size: 10, seed: 1 }).rejected).toEqual([
      "???",
    ]);
    expect(rejectedMessage(["???"])).toBe("“???” has no letters to hide.");
    expect(rejectedMessage(["a", "b"])).toBe("“a” and “b” have no letters to hide.");

    expect(clampSize(3)).toBe(WORD_SEARCH_MIN_SIZE);
    expect(clampSize(99)).toBe(WORD_SEARCH_MAX_SIZE);
    expect(clampSize(11.4)).toBe(11);
    expect(clampSize(Number.NaN)).toBe(WORD_SEARCH_DEFAULT_SIZE);
    expect(generateWordSearch({ words: ["rain"], size: 3, seed: 1 }).size).toBe(8);
    expect(generateWordSearch({ words: ["rain"], size: 99, seed: 1 }).size).toBe(15);
  });

  test("round-trips the toolbar field", () => {
    expect(textToWords("water, cloud\nrain,  ")).toEqual(["water", "cloud", "rain"]);
    expect(wordsToText(["water", "cloud"])).toBe("water, cloud");
  });

  test("reports words it could not fit rather than dropping them", () => {
    const words = [
      "aaaaaaaa",
      "bbbbbbbb",
      "cccccccc",
      "dddddddd",
      "eeeeeeee",
      "ffffffff",
      "gggggggg",
      "hhhhhhhh",
      "iiiiiiii",
    ];
    const grid = generateWordSearch({ words, size: 8, directions: "across-down", seed: 2 });
    expect(grid.unplaced.length).toBeGreaterThan(0);
    for (const word of grid.unplaced) {
      expect(grid.placements.some((p) => p.word === word)).toBe(false);
    }
  });
});

describe("every word reads exactly once", () => {
  test("leaves no second copy of a placed word across 200 seeds of short words", () => {
    const SHORT = ["cat", "dog", "sun", "rat", "bat"];
    for (let seed = 1; seed <= 200; seed++) {
      const grid = generateWordSearch({ words: SHORT, size: 10, directions: "all", seed });
      for (const placement of grid.placements) {
        const occurrences = wordOccurrences(grid.rows, placement.word);
        expect(
          occurrences.length,
          `${placement.word} reads ${occurrences.length}× at seed ${seed}`,
        ).toBe(1);
      }
      for (const word of grid.unplaced) {
        expect(grid.placements.some((p) => p.word === word)).toBe(false);
      }
    }
  });

  test("keeps the words the bank promises and the key rings in step", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const grid = generateWordSearch({ words: WORDS, size: 12, directions: "all", seed });
      const banked = grid.placements.map((p) => p.word);
      expect(new Set(banked).size).toBe(banked.length);
      for (const word of banked) expect(wordOccurrences(grid.rows, word)).toHaveLength(1);
      for (const word of grid.unplaced) expect(banked).not.toContain(word);
    }
  });

  test("findWord finds a word where the placement says it is; a palindrome is one occurrence", () => {
    const grid = generateWordSearch({ words: WORDS, size: 12, directions: "all", seed: 9 });
    for (const placement of grid.placements) {
      expect(findWord(grid, placement.word)).toMatchObject({
        row: placement.row,
        col: placement.col,
      });
    }
    expect(findWord(grid, "ZZZZZZZZZZZZ")).toBeNull();
    expect(findWord(grid, "")).toBeNull();
    const rows = [
      ["N", "O", "O", "N"],
      ["Q", "Q", "Q", "Q"],
      ["Q", "Q", "Q", "Q"],
      ["Q", "Q", "Q", "Q"],
    ];
    expect(wordOccurrences(rows, "NOON")).toHaveLength(1);
  });
});

describe("what the teacher is told", () => {
  test("the lead counts hidden words when the bank is off and names the directions", () => {
    expect(wordSearchLead("all", 5, false)).toBe(
      "Find the 5 hidden words. They run in any direction, including backwards.",
    );
    expect(wordSearchLead("across-down", 1, false)).toBe(
      "Find the hidden word. It runs across and down.",
    );
    expect(wordSearchLead("across-down", 5, true)).toBe(
      "Find every word. They run across and down.",
    );
    expect(wordSearchLead("all", 1, true)).toBe(
      "Find the word. It runs in any direction, including backwards.",
    );
  });

  test("overlong and unplaced words are two faults with two fixes", () => {
    const overlong = wordSearchProblems({
      words: ["cat", "condensation-of-water-vapour"],
      size: 8,
      directions: "all",
      seed: 1,
    });
    expect(overlong).toEqual({
      overlong: ["condensation-of-water-vapour"],
      unplaced: [],
      rejected: [],
    });

    const crowded = wordSearchProblems({
      words: ["cat", "dog", "rat", "bat", "hat", "mat", "sat", "pat"],
      size: 8,
      directions: "all",
      seed: 5,
    });
    expect(crowded.overlong).toEqual([]);
    expect(crowded.unplaced).toEqual(["mat"]);

    expect(unfittableMessage(1)).toBe(
      "1 word does not fit the grid. Make the grid bigger or the word shorter.",
    );
    expect(unfittableMessage(0, 2)).toBe(
      "2 words could not be placed. Shuffle or make the grid bigger.",
    );
    expect(unfittableMessage(1, 2)).toBe(
      "1 word does not fit the grid. Make the grid bigger or the word shorter. 2 words could not be placed. Shuffle or make the grid bigger.",
    );
    expect(unfittableMessage(0, 0)).toBe("");
    expect(wordSearchProblems({ words: WORDS, size: 12, directions: "all", seed: 3 })).toEqual({
      overlong: [],
      unplaced: [],
      rejected: [],
    });
  });
});
