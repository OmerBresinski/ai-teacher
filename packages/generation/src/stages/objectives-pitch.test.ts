import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { sampleBriefLesson } from "../testing";
import { WRITER_BUNDLES } from "../writer/bundle";
import { contextBlock } from "../writer/fixes";
import { buildsOnOf, writerObjectivesUser } from "./objectives";
import { writerBrief } from "./write";

/*
 * v5.2-gold's objectives and writer user turns (bundle base4f-p127; scratchpad/tuning/v5.2-gold
 * BUILDER B1-B5): the subject the topic gives when the lesson has none, the curriculum block with
 * what earlier years taught, "Pupils already know", and the length line only when the teacher
 * set it. base4f-p126's turns are unchanged.
 */

const P127 = WRITER_BUNDLES["base4f-p127"];
const P126 = WRITER_BUNDLES["base4f-p126"];
const Y4_WHOLE =
  "- solve problems involving increasingly harder fractions to calculate quantities, and fractions to divide quantities, including non-unit fractions where the answer is a whole number";
const Y5_MULTIPLY =
  "- multiply proper fractions and mixed numbers by whole numbers, supported by materials and diagrams";

/** The 11 Nov run's Year 5 brief: no subject, the length a default. */
const y5 = (patch: Partial<Lesson> = {}): Lesson =>
  sampleBriefLesson({
    title: "Fractions of amounts",
    subject: undefined,
    yearGroup: "Year 5",
    ageBand: "ks2",
    readingLevel: "Year 5",
    brief: {
      topic: "Fractions of amounts",
      durationMin: 60,
      durationDefaulted: true,
      slideTier: "standard",
    },
    ...patch,
  } as never);

describe("objectives user turn, base4f-p127", () => {
  const user = writerObjectivesUser(y5(), P127.objectivesUser, true);
  test("names the inferred subject and leaves out the defaulted length", () => {
    expect(user).toContain("\nSubject: mathematics\n");
    expect(user).not.toContain("Lesson length");
    expect(user).toMatch(/\nLanguage: en-GB\nSlides: \d+ to \d+\nObjectives: /);
  });
  test("ends on the curriculum block: Year 4 before, then Year 5", () => {
    const at = user.indexOf("\n\nCurriculum statements (statutory, England, mathematics):\n");
    expect(at).toBeGreaterThan(0);
    const block = user.slice(at + 2);
    expect(block).toContain("Taught before Year 5 (Year 4):\n");
    expect(block).toContain(Y4_WHOLE);
    expect(block).toContain("Taught in Year 5:\n");
    expect(block).toContain(Y5_MULTIPLY);
    expect(block.indexOf(Y4_WHOLE)).toBeLessThan(block.indexOf(Y5_MULTIPLY));
    expect(user).not.toContain("{{");
    expect(user.endsWith("\n")).toBe(false);
  });
  test("a length the teacher typed is printed", () => {
    const typed = writerObjectivesUser(
      y5({
        brief: { topic: "Fractions of amounts", durationMin: 45, slideTier: "standard" },
      } as never),
      P127.objectivesUser,
      true,
    );
    expect(typed).toContain("\nLesson length: 45 minutes\nSlides: ");
  });
  test("the lesson's own subject wins over the topic's", () => {
    const own = writerObjectivesUser(y5({ subject: "Maths" }), P127.objectivesUser, true);
    expect(own).toContain("\nSubject: Maths\n");
    expect(own).toContain("Taught before Year 5 (Year 4):");
  });
  test("no data for the topic: no block and no trailing blank line", () => {
    const none = writerObjectivesUser(
      y5({
        title: "Coding with loops",
        brief: { topic: "Coding with loops", durationMin: 60, durationDefaulted: true },
      } as never),
      P127.objectivesUser,
      true,
    );
    expect(none).toContain("\nSubject: \n");
    expect(none).not.toContain("Curriculum statements");
    expect(none).toMatch(/Objectives: [a-z ]+$/);
  });
});

describe("objectives user turn, base4f-p126 (unchanged)", () => {
  test("the blank subject, the 60-minute line, no curriculum", () => {
    const user = writerObjectivesUser(y5(), P126.objectivesUser, false);
    expect(user).toContain("\nSubject: \n");
    expect(user).toContain("\nLesson length: 60 minutes\n");
    expect(user).not.toContain("Curriculum");
    expect(user).not.toContain("mathematics");
  });
});

describe("the writer's user turn, base4f-p127", () => {
  const objectives = [{ teacher: "Find non-unit fractions of amounts.", pupil: "" }];
  test("Pupils already know sits between the objectives and Depth", () => {
    const brief = {
      ...writerBrief(y5()),
      buildsOn: "Year 4 found unit and non-unit fractions of amounts with whole-number answers.",
    };
    const u = contextBlock(brief, objectives, P127.user);
    expect(u).toContain(
      "1. Find non-unit fractions of amounts.\n\nPupils already know: Year 4 found unit and non-unit fractions of amounts with whole-number answers.\n\nDepth: ",
    );
    expect(u).toContain("\nSubject: mathematics\n");
    expect(u).not.toContain("Lesson length");
    expect(u).not.toContain("{{");
  });
  test("no buildsOn: the objectives run straight into Depth", () => {
    const u = contextBlock(writerBrief(y5()), objectives, P127.user);
    expect(u).toContain("1. Find non-unit fractions of amounts.\n\nDepth: ");
    expect(u).not.toContain("Pupils already know");
  });
  test("writerBrief reads facts.buildsOn and the defaulted length", () => {
    const lesson = { ...y5(), facts: { buildsOn: "New to this year group." } } as unknown as Lesson;
    const b = writerBrief(lesson);
    expect(b.buildsOn).toBe("New to this year group.");
    expect(b.durationDefaulted).toBe(true);
    expect(b.inferredSubject).toBe("mathematics");
    expect(writerBrief(y5({ subject: "Science" })).inferredSubject).toBeUndefined();
  });
  test("p126's user turn reads none of it", () => {
    const brief = { ...writerBrief(y5()), buildsOn: "x" };
    const u = contextBlock(brief, objectives, P126.user);
    expect(u).toContain("\nSubject: \n");
    expect(u).toContain("\nLesson length: 60 minutes\n");
    expect(u).not.toContain("Pupils already know");
  });
});

describe("buildsOnOf", () => {
  test("trims, folds spaces, drops empty and non-strings", () => {
    expect(buildsOnOf("  New to this  year group. ")).toBe("New to this year group.");
    expect(buildsOnOf("")).toBeUndefined();
    expect(buildsOnOf("   ")).toBeUndefined();
    expect(buildsOnOf(undefined)).toBeUndefined();
    expect(buildsOnOf(3)).toBeUndefined();
  });
  test("cuts at a word boundary within 300 characters", () => {
    const long = `${"fraction ".repeat(40)}end`;
    const cut = buildsOnOf(long) as string;
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut.endsWith("fraction")).toBe(true);
  });
});
