import { describe, expect, test } from "bun:test";
import {
  CURRICULUM_BEFORE_CAP,
  curriculumFor,
  curriculumPitchBlock,
  curriculumSubjectForTopic,
} from "./index";

/*
 * v5.2-gold's pitch floor (scratchpad/tuning/v5.2-gold/BUILDER.md B1-B3): the subject a lesson
 * with none is looked up in, the statements the nearest earlier year taught the topic, and the
 * block the objectives call reads. A wrong subject sends the wrong statements, so an unclear
 * topic gives no subject rather than a guess.
 */

const Y4_WHOLE =
  "solve problems involving increasingly harder fractions to calculate quantities, and fractions to divide quantities, including non-unit fractions where the answer is a whole number";

describe("curriculumSubjectForTopic (B1)", () => {
  // The 11 Nov run's three briefs (no subject on any), the fixed set's others, and awkward ones.
  test.each([
    ["Fractions of amounts", "Year 5", "mathematics"],
    ["The Great Fire of London", "Year 2", "history"],
    ["Photosynthesis", "Year 8", "science"],
    ["Solving linear equations", "Year 9", "mathematics"],
    ["Plants", "Year 1", "science"],
    ["The Romans in Britain", "Year 4", "history"],
    ["Place value", "Year 3", "mathematics"],
    ["States of matter", "Year 4", "science"],
    ["Persuasive writing", "Year 6", "English"],
    ["Maps and compass directions", "Year 3", "geography"],
    // A languages topic names its language; the language wins over a keyword elsewhere.
    ["Ordering food in a French café", "Year 7", "languages"],
    ["Describing your family in Spanish", "Year 8", "languages"],
    // A topic that spans subjects takes the one with the most evidence, never PE's "water" heading.
    ["The water cycle", "Year 4", "geography"],
    ["Healthy eating and nutrition", "Year 3", "design and technology"],
  ])("%s (%s) -> %s", (topic, year, want) => {
    expect(curriculumSubjectForTopic("England", topic, year)).toBe(want);
  });

  // No subject beats a wrong one: too few of the topic's keywords anywhere, or no data.
  test.each([
    ["Rivers", "Year 8"],
    ["World War 2 evacuees", "Year 6"],
    ["Coding with loops", "Year 5"],
    ["Fractions of amounts", "Reception"],
  ])("%s (%s) -> no subject", (topic, year) => {
    expect(curriculumSubjectForTopic("England", topic, year)).toBeUndefined();
  });

  test("only England has data", () => {
    expect(curriculumSubjectForTopic("India", "Fractions of amounts", "Year 5")).toBeUndefined();
  });
});

describe("curriculumFor: the earlier year (B2)", () => {
  const y5 = curriculumFor(
    {
      country: "England",
      subject: "mathematics",
      yearGroup: "Year 5",
      topic: "Fractions of amounts",
    },
    { matchedOnly: true },
  );
  test("Year 5 fractions: before is Year 4's fractions domain, all 10 rows", () => {
    expect(y5.before.length).toBe(10);
    expect(y5.before.every((s) => s.years[0] === 4 && s.years[1] === 4)).toBe(true);
    expect(new Set(y5.before.map((s) => s.domain))).toEqual(
      new Set(["Number - fractions (including decimals)"]),
    );
    expect(y5.before.map((s) => s.text)).toContain(Y4_WHOLE);
  });
  test("Year 5 fractions: statements are Year 5's matched rows only (no others tail)", () => {
    expect(y5.statements.length).toBeGreaterThan(0);
    expect(y5.statements.every((s) => s.years[0] <= 5 && s.years[1] >= 5)).toBe(true);
    expect(new Set(y5.statements.map((s) => s.domain))).toEqual(new Set(y5.matchedDomains));
  });
  test("without matchedOnly the others tail is still there (base4g)", () => {
    const all = curriculumFor({
      country: "England",
      subject: "mathematics",
      yearGroup: "Year 5",
      topic: "Fractions of amounts",
    });
    expect(all.statements.length).toBeGreaterThan(y5.statements.length);
  });
  test("Year 3 fractions looks back to Year 2", () => {
    const y3 = curriculumFor(
      { country: "England", subject: "maths", yearGroup: "Year 3", topic: "Fractions of amounts" },
      { matchedOnly: true },
    );
    expect(y3.before.length).toBeGreaterThan(0);
    expect(y3.before.every((s) => s.years[1] === 2)).toBe(true);
  });
  test.each([
    ["science", "Year 8", "Photosynthesis"],
    ["history", "Year 2", "The Great Fire of London"],
  ])("%s %s %s: no earlier statements", (subject, yearGroup, topic) => {
    const l = curriculumFor(
      { country: "England", subject, yearGroup, topic },
      { matchedOnly: true },
    );
    expect(l.before).toEqual([]);
    expect(l.statements.length).toBeGreaterThan(0);
  });
  test("no topic: no earlier statements; a cap holds them", () => {
    expect(
      curriculumFor({ country: "England", subject: "mathematics", yearGroup: "Year 5" }).before,
    ).toEqual([]);
    expect(CURRICULUM_BEFORE_CAP).toBe(10);
  });
});

describe("curriculumPitchBlock (B3)", () => {
  test("Year 5 fractions: before then this year, fractions written a/b", () => {
    const block = curriculumPitchBlock(
      curriculumFor(
        {
          country: "England",
          subject: "mathematics",
          yearGroup: "Year 5",
          topic: "Fractions of amounts",
        },
        { matchedOnly: true },
      ),
      "Year 5",
    );
    const lines = block.split("\n");
    expect(lines[0]).toBe("Curriculum statements (statutory, England, mathematics):");
    expect(lines[1]).toBe("Taught before Year 5 (Year 4):");
    expect(lines[2]).toBe("Number - fractions (including decimals)");
    expect(lines).toContain(`- ${Y4_WHOLE}`);
    expect(lines).toContain("Taught in Year 5:");
    expect(lines.indexOf("Taught in Year 5:")).toBeGreaterThan(lines.indexOf(`- ${Y4_WHOLE}`));
    expect(block).toContain("- recognise and write decimal equivalents to 1/4, 1/2, 3/4");
    expect(block).not.toContain("[Fraction:");
  });
  test("KS3 photosynthesis: no 'Taught before' section; the band is Years 7 to 9", () => {
    const block = curriculumPitchBlock(
      curriculumFor(
        { country: "England", subject: "science", yearGroup: "Year 8", topic: "Photosynthesis" },
        { matchedOnly: true },
      ),
      "Year 8",
    );
    expect(block).not.toContain("Taught before");
    expect(block).toContain("Taught in Years 7 to 9:");
    expect(block).toContain("- the adaptations of leaves for photosynthesis");
  });
  test("nothing matched and nothing before: empty", () => {
    expect(
      curriculumPitchBlock(
        curriculumFor(
          { country: "England", subject: "mathematics", yearGroup: "Year 5", topic: "Volcanoes" },
          { matchedOnly: true },
        ),
        "Year 5",
      ),
    ).toBe("");
  });
});
