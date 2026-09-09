import { describe, expect, test } from "bun:test";
import {
  fleschKincaidGrade,
  meanSentenceLength,
  ngrams,
  readingAge,
  sentenceLengths,
  syllables,
  words,
} from "./text-metrics";

describe("text metrics", () => {
  test("words keeps apostrophes and hyphens inside a word and lower-cases", () => {
    expect(words("The rat's ever-growing teeth; 2 pairs!")).toEqual([
      "the",
      "rat's",
      "ever-growing",
      "teeth",
      "2",
      "pairs",
    ]);
  });

  test("sentenceLengths splits on terminal punctuation; a fragment is one sentence", () => {
    expect(sentenceLengths("Rats gnaw. Mice gnaw too! Do voles? yes")).toEqual([2, 3, 2, 1]);
    expect(sentenceLengths("")).toEqual([]);
    expect(meanSentenceLength("One two three four. Five six.")).toBe(3);
    expect(meanSentenceLength("   ")).toBeNull();
  });

  test("syllables: vowel groups with the usual corrections", () => {
    expect(syllables("cat")).toBe(1);
    expect(syllables("water")).toBe(2);
    expect(syllables("evaporation")).toBe(5);
    expect(syllables("table")).toBe(2);
    expect(syllables("jumped")).toBe(1);
    expect(syllables("the")).toBe(1);
    expect(syllables("")).toBe(0);
  });

  test("Flesch–Kincaid grade and reading age: short simple sentences read young, long Latinate ones old", () => {
    const young = "The sun warms the sea. Water goes up as vapour. It cools and makes clouds.";
    const old =
      "Evaporation, condensation and precipitation constitute the fundamental mechanisms whereby atmospheric moisture is continuously redistributed across terrestrial environments.";
    const g1 = fleschKincaidGrade(young);
    const g2 = fleschKincaidGrade(old);
    if (g1 === null || g2 === null) throw new Error("grade");
    expect(g1).toBeLessThan(4);
    expect(g2).toBeGreaterThan(14);
    expect(readingAge(young)).toBeLessThan(9);
    expect(readingAge(old)).toBeGreaterThan(19);
    expect(readingAge("")).toBeNull();
  });

  test("ngrams: every run of n words, lower-cased", () => {
    expect(ngrams("One pair of ever-growing incisors", 5)).toEqual([
      "one pair of ever-growing incisors",
    ]);
    expect(ngrams("a b c d", 3)).toEqual(["a b c", "b c d"]);
    expect(ngrams("a b", 3)).toEqual([]);
  });
});
