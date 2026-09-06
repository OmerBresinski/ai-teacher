import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  CAPITALISED_ALLOW_LIST,
  findNamePatterns,
  GUARD_MESSAGE,
  guarded,
} from "./identifier-guard";

const kinds = (text: string): string[] => findNamePatterns(text).map((p) => p.kind);

describe("findNamePatterns", () => {
  describe("flags", () => {
    test.each([
      ["an email address", "contact j.smith@school.org for details", ["email"]],
      ["a UPN-length digit run", "one pupil has UPN 1234567890", ["id-number"]],
      ["a six-digit admission number", "admission no 123456", ["id-number"]],
      ["Firstname Surname mid-sentence", "Help Amir Khan with fractions", ["capitalised-pair"]],
      ["a name after a comma", "mixed ability, Priya Patel needs support", ["capitalised-pair"]],
      ["'pupil called'", "one pupil called Sam struggles", ["pupil-phrase"]],
      ["'student named'", "a student named Lee", ["pupil-phrase"]],
      ["'child called' in any case", "A Child Called Jo", ["pupil-phrase", "capitalised-pair"]],
    ])("%s", (_label, text, expected) => {
      expect(kinds(text)).toEqual(expected);
    });

    test("returns the match and its offset, in order of appearance", () => {
      const text = "Help Amir Khan (a@b.io)";
      expect(findNamePatterns(text)).toEqual([
        { kind: "capitalised-pair", match: "Amir Khan", index: 5 },
        { kind: "email", match: "a@b.io", index: 16 },
      ]);
    });

    test("a three-word name is one pair, not two", () => {
      expect(findNamePatterns("about Amir Khan Smith")).toHaveLength(1);
    });
  });

  describe("allows", () => {
    test.each([
      ["curriculum vocabulary", "Year 5 Key Stage 2 Roman Britain"],
      ["a sentence-initial pair", "Fractions Of amounts"],
      ["a pair after a full stop", "Recap first. Fractions Practice next"],
      ["subject names", "English Literature and Modern Foreign Languages"],
      ["month names", "Taught in September October"],
      ["a lone capitalised word", "The Romans"],
      ["short digit runs", "Year 5, class 6B, room 12345"],
      ["single-letter words", "I teach Maths"],
      ["a pair split by a newline", "Amir\nKhan"],
      ["plain lower-case text", "the class knows equivalent fractions and can simplify"],
      ["the empty string", ""],
    ])("%s", (_label, text) => {
      expect(findNamePatterns(text)).toEqual([]);
    });
  });

  describe("documented false positives", () => {
    // Proper nouns that are not learners still trip the pair heuristic; the message asks the
    // teacher to reword ("Newton's laws"). Accepted at MVP (TEACH-116 "Dependencies & Risks").
    test.each([
      ["the laws of Isaac Newton"],
      ["nursing and Florence Nightingale"],
      ["climbing Mount Everest"],
    ])("%s is flagged", (text) => {
      expect(kinds(text)).toEqual(["capitalised-pair"]);
    });

    // The mirror image: a pair that opens the text reads as a title-case heading, so a topic
    // that is only a name passes. The API and the form still guard every other position.
    test("a pair at the very start of the text is treated as a sentence start", () => {
      expect(kinds("Isaac Newton")).toEqual([]);
    });
  });

  test("the allow-list is exported and non-empty", () => {
    expect(CAPITALISED_ALLOW_LIST.length).toBeGreaterThan(20);
    expect(CAPITALISED_ALLOW_LIST).toContain("Year");
  });
});

describe("guarded", () => {
  test("rejects with GUARD_MESSAGE and keeps the base constraints", () => {
    const schema = guarded(z.string().max(14));
    expect(schema.safeParse("fractions").success).toBe(true);
    const flagged = schema.safeParse("re Amir Khan");
    expect(flagged.success).toBe(false);
    expect(flagged.error?.issues[0]?.message).toBe(GUARD_MESSAGE);
    expect(schema.safeParse("a very long clean string").success).toBe(false);
  });
});
