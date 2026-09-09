import { describe, expect, test } from "bun:test";
import {
  allDistinct,
  decodeEntities,
  hasLeakedPupilPhrase,
  hasLeakedRepairPhrase,
  isClassifyStem,
  isDoubleStatement,
  isOneOf,
  normaliseText,
  sameLeadingToken,
} from "./text-guards";

describe("text guards", () => {
  test("decodeEntities handles the named five, apostrophes and numeric codes, and leaves the rest", () => {
    expect(
      decodeEntities("Teeth &amp; Claws &lt;3&gt; &quot;yes&quot; it&#39;s &apos;ok&apos;"),
    ).toBe("Teeth & Claws <3> \"yes\" it's 'ok'");
    expect(decodeEntities("caf&#233; &#8212; done")).toBe("café — done");
    expect(decodeEntities("&nbsp;stays &unknown; &#99999999;")).toBe(
      "&nbsp;stays &unknown; &#99999999;",
    );
    expect(decodeEntities("plain")).toBe("plain");
  });

  test("leaked pupil phrases: house rules and prompt vocabulary, case-insensitively; JSON as a word", () => {
    for (const t of [
      "Hand in your answers — no names needed.",
      "Write in british english.",
      "Use the fact id o1.",
      "echo the factRefs",
      "Answer in JSON only",
      "As an AI language model I cannot",
    ]) {
      expect(hasLeakedPupilPhrase(t), t).toBe(true);
    }
    for (const t of ["Name three rodents.", "Jason went home.", "Fact: rodents gnaw."]) {
      expect(hasLeakedPupilPhrase(t), t).toBe(false);
    }
  });

  test("leaked repair phrases: commentary openers and the finding, not ordinary teaching notes", () => {
    for (const t of [
      "Corrected the rodent definition so that it matches the facts.",
      "  Updated per the review.",
      "This addresses the finding about the answer.",
      "Passes validation now.",
    ]) {
      expect(hasLeakedRepairPhrase(t), t).toBe(true);
    }
    for (const t of [
      "Ask pupils which animal is not a rodent.",
      "Model the first step on the board.",
    ]) {
      expect(hasLeakedRepairPhrase(t), t).toBe(false);
    }
  });

  test("normaliseText, allDistinct and isOneOf ignore case, punctuation and spacing", () => {
    expect(normaliseText("  One pair, of  Incisors! ")).toBe("one pair of incisors");
    expect(allDistinct(["Rat", "Mouse", "rat "])).toBe(false);
    expect(allDistinct(["Rat", "Mouse", "Vole"])).toBe(true);
    expect(allDistinct([])).toBe(true);
    expect(isOneOf("open your book", ["Open your book.", "Sit down"])).toBe(true);
    expect(isOneOf("3 minutes", ["Open your book."])).toBe(false);
  });

  test("kind fit: classify stems, same-first-word steps, double statements", () => {
    expect(isClassifyStem("Classify these animals")).toBe(true);
    expect(isClassifyStem("Sort into rodents and non-rodents")).toBe(true);
    expect(isClassifyStem("Put the stages in order")).toBe(false);
    expect(sameLeadingToken(["Rodent: rat", "Rodent: mouse", "rodent vole"])).toBe(true);
    expect(sameLeadingToken(["Melt", "Boil", "Condense"])).toBe(false);
    expect(sameLeadingToken(["Only one"])).toBe(false);
    const long = "a".repeat(61);
    expect(isDoubleStatement(`${long} and ${long}`)).toBe(true);
    expect(isDoubleStatement("Rats and mice are rodents")).toBe(false);
    expect(isDoubleStatement(`${long} and short`)).toBe(false);
  });
});
