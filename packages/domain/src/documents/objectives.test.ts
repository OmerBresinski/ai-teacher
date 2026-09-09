import { describe, expect, test } from "bun:test";
import { OBJECTIVES_SLIDE_HEADING, objectiveLine, pupilObjective } from "./objectives";

describe("OBJECTIVES_SLIDE_HEADING", () => {
  test("is the stem the slide's lines complete", () => {
    expect(OBJECTIVES_SLIDE_HEADING).toBe("By the end of this lesson I can");
  });
});

describe("pupilObjective", () => {
  test("adds the stem and lower-cases the first letter", () => {
    expect(pupilObjective("Describe the arrangement of particles in solids")).toBe(
      "I can describe the arrangement of particles in solids",
    );
  });

  test("is idempotent when the text already starts with I can, any case", () => {
    expect(pupilObjective("I can describe the stages")).toBe("I can describe the stages");
    expect(pupilObjective("i can describe the stages")).toBe("I can describe the stages");
    expect(pupilObjective(pupilObjective("Explain melting"))).toBe("I can explain melting");
  });

  test("leaves I can't and I cannot alone", () => {
    expect(pupilObjective("I can't yet divide fractions")).toBe("I can't yet divide fractions");
    expect(pupilObjective("I cannot divide fractions")).toBe("I cannot divide fractions");
  });

  test("does not treat a word that starts with can as the stem", () => {
    expect(pupilObjective("I candle")).toBe("I can I candle");
  });

  test("keeps the first letter of an acronym or proper noun", () => {
    expect(pupilObjective("NASA missions in order")).toBe("I can NASA missions in order");
    expect(pupilObjective("SI units for length")).toBe("I can SI units for length");
    expect(pupilObjective("DNA-based tests")).toBe("I can DNA-based tests");
  });

  test("lower-cases a single-letter first word and leaves a lower-case start alone", () => {
    expect(pupilObjective("A poem in three stanzas")).toBe("I can a poem in three stanzas");
    expect(pupilObjective("explain melting")).toBe("I can explain melting");
  });

  test("trims, and gives an empty string for empty or whitespace input", () => {
    expect(pupilObjective("  Explain melting  ")).toBe("I can explain melting");
    expect(pupilObjective("")).toBe("");
    expect(pupilObjective("   \n\t")).toBe("");
  });
});

describe("objectiveLine", () => {
  test("lower-cases the first letter and returns the phrase alone", () => {
    expect(objectiveLine("Describe the stages of the water cycle")).toBe(
      "describe the stages of the water cycle",
    );
    expect(objectiveLine("Explain how evaporation and condensation are linked")).toBe(
      "explain how evaporation and condensation are linked",
    );
  });

  test("drops a stem the text already carries so the heading is not said twice", () => {
    expect(objectiveLine("I can describe the stages")).toBe("describe the stages");
    expect(objectiveLine("i can  Describe the stages")).toBe("describe the stages");
  });

  test("keeps an acronym, a proper noun and the pronoun I", () => {
    expect(objectiveLine("NASA missions in order")).toBe("NASA missions in order");
    expect(objectiveLine("SI units for length")).toBe("SI units for length");
    expect(objectiveLine("I know my tables")).toBe("I know my tables");
  });

  test("trims, and gives an empty string for empty or whitespace input", () => {
    expect(objectiveLine("  Explain melting ")).toBe("explain melting");
    expect(objectiveLine("")).toBe("");
    expect(objectiveLine(" \n ")).toBe("");
  });
});
