import { describe, expect, test } from "bun:test";
import type { WorksheetBlock } from "@tj/domain/documents";
import { docFromText } from "../model/factories";
import {
  answerEntry,
  type FillGapBlock,
  matchingLetters,
  matchingOrder,
  optionLetter,
  orderedGaps,
} from "./answers";

const fillGap = (text: string, gaps: FillGapBlock["gaps"], number?: number): FillGapBlock => ({
  id: "fg-1",
  type: "fill-gap",
  doc: docFromText(text),
  gaps,
  number,
});

describe("optionLetter", () => {
  test("A–Z, then ? past the alphabet", () => {
    expect(optionLetter(0)).toBe("A");
    expect(optionLetter(25)).toBe("Z");
    expect(optionLetter(26)).toBe("?");
  });
});

describe("orderedGaps", () => {
  test("returns gaps in the order their tokens appear in the text", () => {
    const block = fillGap("Water [[gap:b]] when heated and [[gap:a]] when cooled.", [
      { id: "a", answer: "condenses" },
      { id: "b", answer: "evaporates" },
    ]);
    expect(orderedGaps(block).map((g) => g.id)).toEqual(["b", "a"]);
  });

  test("excludes an orphan, counts a repeated token once, and is empty with no tokens", () => {
    expect(
      orderedGaps(
        fillGap("Water [[gap:a]] when heated.", [
          { id: "a", answer: "evaporates" },
          { id: "orphan", answer: "condenses" },
        ]),
      ).map((g) => g.id),
    ).toEqual(["a"]);
    expect(
      orderedGaps(
        fillGap("It [[gap:a]] then it [[gap:a]] again.", [{ id: "a", answer: "evaporates" }]),
      ),
    ).toHaveLength(1);
    expect(orderedGaps(fillGap("No blanks.", [{ id: "a", answer: "x" }]))).toEqual([]);
  });
});

describe("matchingOrder", () => {
  test("is a permutation of 0..n-1, deterministic per id and different across ids", () => {
    const a = matchingOrder("block-a", 6);
    expect([...a].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(matchingOrder("block-a", 6)).toEqual(a);
    const others = ["block-b", "block-c", "block-d"].map((id) => matchingOrder(id, 6));
    expect(others.some((order) => order.join() !== a.join())).toBe(true);
    expect(matchingOrder("x", 0)).toEqual([]);
    expect(matchingOrder("x", 1)).toEqual([0]);
  });

  test("matchingLetters labels left item i with the letter of the position its pair was shuffled to", () => {
    const order = matchingOrder("block-id", 4);
    const letters = matchingLetters("block-id", 4);
    order.forEach((pairIndex, position) => {
      expect(letters[pairIndex]).toBe(optionLetter(position));
    });
  });
});

describe("answerEntry", () => {
  test("fill-gap numbers only the live gaps, in token order", () => {
    const one = answerEntry(
      fillGap(
        "Water [[gap:a]] when heated.",
        [
          { id: "a", answer: "evaporates" },
          { id: "orphan", answer: "condenses" },
        ],
        3,
      ),
    );
    expect(one?.lines).toEqual(["1. evaporates"]);
    const two = answerEntry(
      fillGap(
        "It [[gap:b]] then [[gap:a]].",
        [
          { id: "a", answer: "condenses" },
          { id: "b", answer: "evaporates" },
        ],
        5,
      ),
    );
    expect(two?.lines).toEqual(["1. evaporates", "2. condenses"]);
  });

  test("question without an answer, unnumbered blocks and word searches", () => {
    const q: WorksheetBlock = {
      id: "q",
      type: "question",
      doc: docFromText("Q"),
      answerLines: 2,
      number: 2,
    };
    expect(answerEntry(q)).toEqual({
      id: "q",
      number: 2,
      marks: undefined,
      lines: ["No answer recorded."],
    });
    expect(answerEntry({ ...q, number: undefined })).toBeNull();
    expect(answerEntry({ id: "p", type: "paragraph", doc: docFromText("x") })).toBeNull();
    const search: WorksheetBlock = {
      id: "ws",
      type: "word-search",
      words: ["rain"],
      size: 8,
      directions: "all",
      seed: 1,
      showWordBank: true,
      number: 4,
    };
    expect(answerEntry(search)).toEqual({ id: "ws", number: 4, lines: [], search });
    const matching: WorksheetBlock = {
      id: "m",
      type: "matching",
      number: 1,
      pairs: [
        { id: "1", left: "L1", right: "R1" },
        { id: "2", left: "L2", right: "R2" },
      ],
    };
    const letters = matchingLetters("m", 2);
    expect(answerEntry(matching)?.lines).toEqual([`L1: ${letters[0]} R1`, `L2: ${letters[1]} R2`]);
  });
});
