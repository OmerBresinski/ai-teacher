import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { findNamePatterns, GUARD_MESSAGE, guarded } from "./identifier-guard";

const kinds = (text: string): string[] => findNamePatterns(text).map((p) => p.kind);

describe("findNamePatterns", () => {
  describe("flags", () => {
    test.each([
      ["an email address", "contact j.smith@school.org for details", ["email"]],
      ["a UPN-length digit run", "one pupil has UPN 1234567890", ["id-number"]],
      ["a six-digit admission number", "admission no 123456", ["id-number"]],
      ["'pupil called'", "one pupil called Sam struggles", ["pupil-phrase"]],
      ["'student named'", "a student named Lee", ["pupil-phrase"]],
      ["'child called' in any case", "A Child Called Jo", ["pupil-phrase"]],
    ])("%s", (_label, text, expected) => {
      expect(kinds(text)).toEqual(expected);
    });

    test("returns the match and its offset, in order of appearance", () => {
      const text = "a learner named Jo (a@b.io) 12345678";
      expect(findNamePatterns(text)).toEqual([
        { kind: "pupil-phrase", match: "learner named", index: 2 },
        { kind: "email", match: "a@b.io", index: 20 },
        { kind: "id-number", match: "12345678", index: 28 },
      ]);
    });
  });

  describe("allows", () => {
    test.each([
      ["a Title Case topic", "How Lego Bricks Are Made"],
      ["a proper-noun topic", "Ancient Greek Gods and Isaac Newton"],
      ["a bare name — names alone are not identifiers without context (TEACH-137)", "Amir Khan"],
      ["curriculum vocabulary", "Year 5 Key Stage 2 Roman Britain"],
      ["subject names", "English Literature and Modern Foreign Languages"],
      ["short digit runs", "Year 5, class 6B, room 12345"],
      ["plain lower-case text", "the class knows equivalent fractions and can simplify"],
      ["the empty string", ""],
    ])("%s", (_label, text) => {
      expect(findNamePatterns(text)).toEqual([]);
    });
  });
});

describe("guarded", () => {
  test("rejects with GUARD_MESSAGE and keeps the base constraints", () => {
    const schema = guarded(z.string().max(24));
    expect(schema.safeParse("fractions").success).toBe(true);
    const flagged = schema.safeParse("a pupil called Amir");
    expect(flagged.success).toBe(false);
    expect(flagged.error?.issues[0]?.message).toBe(GUARD_MESSAGE);
    expect(schema.safeParse("a very long clean string indeed").success).toBe(false);
  });
});
