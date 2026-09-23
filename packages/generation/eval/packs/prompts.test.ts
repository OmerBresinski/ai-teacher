import { describe, expect, test } from "bun:test";
import {
  planFactsObjectivePrompt,
  REFERENCE_INSTRUCTION,
  SHAPE_SKETCH,
} from "../../src/prompts/plan-facts-objective";
import { lessonShapeOf } from "../../src/shapes";
import {
  assertNoStubs,
  FACTS_COUNTS_LINE,
  FACTS_MISCONCEPTION_REF_LINE,
  FACTS_SHAPE_LINES,
  fillShapeSketch,
  isStub,
  PACK_PROMPTS,
  type PackFillInput,
  PackWriteOutputSchema,
  packFillPrompt,
  packRewritePrompt,
} from "./prompts";

/*
 * The two written pack prompts (pack-rewrite.v2, pack-fill.v2; 23 Sept 2026). Wording is pinned by
 * `experiments/np1.json` (`np1.ts --freeze`); here the tests hold what the prompts must carry on
 * the gateway's non-strict route (counts in prose) and how the fill call is derived from the facts
 * call, so a facts-prompt edit that breaks the derivation fails here, not in a live run.
 */

const shape = lessonShapeOf(
  { objectiveVerb: "Calculate a share in a given ratio", priorConfidence: "New to it" },
  { yearGroup: "Year 6" },
);

const fillInput = (types: PackFillInput["types"], target = 1): PackFillInput => ({
  topic: "Ratio",
  shape,
  audience: { subject: "Maths", yearGroup: "Year 6" },
  objectives: [
    { text: "Describe what a ratio compares" },
    { text: "Calculate a share in a given ratio" },
  ],
  target,
  reference: { text: "- Key idea: A ratio compares two amounts. Example: 2:3." },
  types,
});

describe("pack prompts", () => {
  test("pack-rewrite and pack-fill are written; the rest are still stubs and refuse a live run", () => {
    expect(isStub(packRewritePrompt)).toBe(false);
    expect(isStub(packFillPrompt)).toBe(false);
    expect(() => assertNoStubs([packRewritePrompt, packFillPrompt])).not.toThrow();
    const stubs = Object.values(PACK_PROMPTS)
      .filter(isStub)
      .map((p) => p.version);
    expect(stubs).toEqual([
      "pack-knowledge.v0.stub",
      "pack-link.v0.stub",
      "judge-addendum.v0.stub",
    ]);
    expect(() => assertNoStubs(Object.values(PACK_PROMPTS))).toThrow(/stubs not yet written/);
  });

  test("pack-rewrite: checker first, goals ranked, every count in prose once, exits where quality is forced", () => {
    const system = packRewritePrompt.system;
    expect(system.indexOf("How the output is checked")).toBeLessThan(
      system.indexOf("What matters, in order"),
    );
    expect(system).toContain("eight or more consecutive words");
    expect(system).toContain("one unbroken run of at most 25 words");
    for (const count of [
      "keyIdeas, one to three",
      "misconceptions, up to two",
      "vocabulary, up to three",
      "workedExamples, one only when",
      "questions, three or four",
      "three distractors",
    ])
      expect(system).toContain(count);
    expect(system).toContain("Omit rather than invent; none is fine");
    expect(system).toContain("never a second correct answer");
    expect(system).toContain("set the question as open-response and give none");
    expect(system).toContain("Years 1-6");
    expect(system).toContain("in British English");
    expect(system).not.toContain("Most questions should be multiple-choice");
    // v2: the snippet check is stated once (the Evidence line); no schema literal is restated.
    expect(system).not.toContain("word for word");
    expect(system).not.toContain("objectiveRefs");
    expect(system).not.toContain("(statement, explanation and example");
    // Misconceptions may be none: the fill call writes one for a section without any.
    const ev = [{ sentenceIds: ["s1.1"], snippet: "a ratio compares" }];
    const q = {
      stem: "s",
      answer: "a",
      reasoning: "r",
      tier: "core",
      use: "slide",
      demand: "recall",
      forms: ["open-response"],
      evidence: ev,
    };
    const none = PackWriteOutputSchema.safeParse({
      keyIdeas: [{ statement: "s", explanation: "e", example: "x", evidence: ev }],
      misconceptions: [],
      vocabulary: [],
      workedExamples: [],
      questions: [q, q, q],
    });
    expect(none.success).toBe(true);
    // v2: a key idea has no `analogy` slot, so one cannot be filled unsupported.
    const analogy = PackWriteOutputSchema.safeParse({
      keyIdeas: [{ statement: "s", explanation: "e", example: "x", analogy: "a", evidence: ev }],
      misconceptions: [],
      vocabulary: [],
      workedExamples: [],
      questions: [q, q, q],
    });
    expect(analogy.success).toBe(false);
  });

  test("pack-rewrite: the user turn renders the inputs once, sentences as `id: text`", () => {
    const user = packRewritePrompt.user({
      topic: "ratio",
      subject: "Maths",
      yearGroup: "Year 6",
      outcome: "Describe what a ratio compares",
      sentences: [{ id: "s1.4", heading: "Ratio", text: "A ratio compares two quantities." }],
    });
    expect(user).toBe(
      [
        "Topic: ratio",
        "Subject: Maths; Year group: Year 6",
        "Outcome: Describe what a ratio compares",
        "Source sentences:",
        "s1.4: A ratio compares two quantities.",
      ].join("\n"),
    );
  });

  test("pack-fill: the facts system with three pinned pieces changed and nothing else", () => {
    const facts = planFactsObjectivePrompt.system;
    for (const piece of [FACTS_COUNTS_LINE, FACTS_MISCONCEPTION_REF_LINE, FACTS_SHAPE_LINES])
      expect(facts).toContain(piece);
    const fill = packFillPrompt.system;
    expect(fill).not.toContain(FACTS_COUNTS_LINE);
    expect(fill).toContain('Write only the lists the brief\'s "Lists to write" line names');
    // The ref rule goes (packWithFill strips the ref); the shape moves to the user turn.
    expect(fill).not.toContain("misconceptionRef");
    expect(fill).not.toContain("JSON, in this shape");
    expect(fill).not.toContain(SHAPE_SKETCH);
    expect(fill.replace(/Write only the lists.*\n/, "")).toBe(
      facts
        .replace(`${FACTS_COUNTS_LINE}\n`, "")
        .replace(`${FACTS_MISCONCEPTION_REF_LINE}\n`, "")
        .replace(FACTS_SHAPE_LINES, ""),
    );
  });

  test("pack-fill: the user turn is the facts call's, plus the reference, the lists line and their sketch", () => {
    // Types render in the schema's order, whatever order the caller gives.
    const user = packFillPrompt.user(fillInput(["questions", "vocabulary"]));
    expect(user).toContain(REFERENCE_INSTRUCTION);
    expect(user).toContain("- Key idea: A ratio compares two amounts.");
    expect(user).toContain("Write the facts for objective 1: Calculate a share in a given ratio");
    const tail = user.split("\n").slice(-3);
    expect(tail[0]).toBe("Lists to write: vocabulary, questions.");
    expect(tail[1]).toBe("JSON, in this shape:");
    expect(Object.keys(JSON.parse(tail[2] ?? ""))).toEqual(["vocabulary", "questions"]);
    expect(user).not.toContain("already written");
    const withConcepts = packFillPrompt.user({
      ...fillInput(["questions"]),
      concepts: ["sharing in a ratio", "simplifying"],
    });
    expect(withConcepts).toContain(
      "Lists to write: questions, covering: sharing in a ratio; simplifying.\nJSON, in this shape:\n",
    );
  });

  test("pack-fill: the sketch is the facts sketch's own lists, picked", () => {
    const full = JSON.parse(SHAPE_SKETCH) as Record<string, unknown>;
    expect(
      fillShapeSketch(["keyIdeas", "misconceptions", "vocabulary", "workedExamples", "questions"]),
    ).toBe(SHAPE_SKETCH);
    expect(JSON.parse(fillShapeSketch(["misconceptions", "questions"]))).toEqual({
      misconceptions: full.misconceptions,
      questions: full.questions,
    });
    expect(fillShapeSketch(["questions"])).toContain('"distractors":[{"text":"…"}');
  });

  test("pack-fill: the worked-example line goes when that list is not wanted, stays when it is", () => {
    // Objective 1 is Apply-level, so the facts call would say "required".
    const factsUser = planFactsObjectivePrompt.user(fillInput(["questions"]));
    expect(factsUser).toContain("Worked example: required for this objective.");
    expect(packFillPrompt.user(fillInput(["questions"]))).not.toContain("Worked example:");
    expect(packFillPrompt.user(fillInput(["workedExamples", "questions"]))).toContain(
      "Worked example: required for this objective.",
    );
    // A "none" call keeps its line too: code decided, the fill schema allows an empty list.
    expect(packFillPrompt.user(fillInput(["workedExamples"], 0))).toContain(
      "Worked example: none for this objective.",
    );
  });
});
