import { describe, expect, test } from "bun:test";
import { SPEC_LIMITS } from "@tj/slides";
import { lessonShapeOf } from "../shapes";
import { audienceOf } from "../stages/shared";
import { sampleBriefLesson } from "../testing";
import { planFactsObjectivePrompt, REFERENCE_INSTRUCTION } from "./plan-facts-objective";
import { CURRICULUM_INSTRUCTION, PRIOR_KNOWLEDGE_LABEL } from "./plan-objectives";
import {
  type PlanTeachObjectiveInput,
  PlanTeachObjectiveOutputSchema,
  planTeachObjectiveOutputSchemaFor,
  planTeachObjectivePrompt,
  TEACH_SHAPE_SKETCH,
  workedExampleLine,
} from "./plan-teach-objective";

/*
 * lab/pw wave 2: the teach half of `plan-facts-objective` v14, pinned the way that call is. The
 * sample is v14's (three objectives, a curriculum unit, reference facts), so the lane wording, the
 * target line and both instructions are in the hash.
 */
const audience = audienceOf(sampleBriefLesson());

const SHAPE = lessonShapeOf(
  { objectiveVerb: "Explain the Roman invasion of Britain", priorConfidence: "New to it" },
  { yearGroup: "Year 4" },
);

const SAMPLE: PlanTeachObjectiveInput = {
  topic: "The Roman invasion of Britain",
  audience: { ...audience, subject: "History", yearGroup: "Year 4" },
  shape: SHAPE,
  objectives: [
    { text: "Explain why the Romans invaded Britain" },
    { text: "Explain how the Romans changed daily life in Britain" },
    { text: "Explain why Boudica led a revolt" },
  ],
  target: 1,
  curriculum: {
    text: [
      "Programme of study: the Roman Empire and its impact on Britain.",
      "Key learning points: the Romans invaded Britain in AD 43; roads and towns changed daily life;",
      "Boudica's revolt was defeated in AD 61.",
    ].join("\n"),
  },
  reference: { text: "- Term: villa — a large Roman country house with farmland." },
};

const PIN: { version: string; hash: string } = {
  version: "plan-teach-objective.v2",
  hash: "b21f50f882b9f225c4a98ccbe99f2119815050b71ca45e8c192a5faf24271dc6",
};

const KEY_IDEA = {
  statement: "Roman roads let soldiers and goods move quickly between new towns.",
  explanation: "Straight, paved roads meant an army could march to trouble in days, not weeks.",
  example: "Watling Street ran from Dover to Wroxeter, about 250 miles.",
};
const MISCONCEPTION = {
  belief: "The Romans left no trace in Britain.",
  correction: "Roads, baths and town walls from Roman Britain still stand today.",
};
const VOCABULARY = { term: "Empire", definition: "A group of lands ruled by one country." };
const WORKED_EXAMPLE = {
  problem: "Why did the Romans build a road from Dover to London?",
  steps: ["Dover is where soldiers landed.", "London was the biggest town."],
  answer: "So soldiers and supplies could reach the biggest town quickly.",
  objectiveRefs: [{ type: "objective", index: 1 }],
};
const taught = (over: Record<string, unknown> = {}) => ({
  keyIdeas: [KEY_IDEA],
  misconceptions: [MISCONCEPTION],
  vocabulary: [VOCABULARY],
  workedExamples: [WORKED_EXAMPLE],
  ...over,
});

describe("plan-teach-objective", () => {
  test("text hash matches its pinned version", () => {
    const text = `${planTeachObjectivePrompt.system}\n---\n${planTeachObjectivePrompt.user(SAMPLE)}`;
    const actual: { version: string; hash: string } = {
      version: planTeachObjectivePrompt.version,
      hash: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    };
    expect(actual).toEqual(PIN);
  });

  test("the system text is v14's teach rules and nothing about questions", () => {
    const system = planTeachObjectivePrompt.system;
    const v14 = planFactsObjectivePrompt.system;
    // v14 is 487 words; the questions took their rules with them. The alarm follows the count.
    expect(system.trim().split(/\s+/).length).toBeLessThan(330);
    expect(system).toContain("British English");
    expect(system).toContain("Never invent or include the name of any pupil");
    expect(system).not.toContain("factRefs");
    expect(system).toContain("Other calls write the questions and the other objectives");
    expect(system).not.toContain("outline");
    expect(system).not.toContain("minute");
    // v14's teach rules, byte for byte where the sentence concerns only these fields.
    for (const kept of [
      "A key idea's example is one named case showing the explanation at work (a place, person, event, reaction, quotation or worked numbers)",
      "a key idea's date, figure or case is real, from the curriculum extract or checkable by the class, and an uncertain figure is left out, never estimated.",
      "Vocabulary is the terms this objective introduces and the class will not know, or none. A definition uses none of the term's own words, only words the class already has.",
      'Follow the brief\'s worked-example line. A worked example is the method on one problem; without a calculation, its steps annotate a model answer. Its "objectiveRefs" list every objective it serves, by index, this one included.',
      "A quotation is one line, cut with an ellipsis.",
    ]) {
      expect(v14).toContain(kept);
      expect(system).toContain(kept);
    }
    // v2 (audit B1): prior knowledge is read from the audience block.
    expect(system).toContain(
      "Pitch the language, numbers and problem steps at the year group and reading level given; explain any word a pupil at that level would not know.",
    );
    expect(system).toContain(
      'Where the brief gives "Prior knowledge", treat it as met and build nothing outside it.',
    );
    // Reworded for the split: the counts line without questions, the case rule without questions,
    // the units rule with "problem" for "question", the ref rule for the worked example alone.
    expect(system).toContain(
      "Write one or two key ideas, one misconception and up to two vocabulary terms.",
    );
    expect(system).toContain("the worked example takes a case of its own.");
    expect(system).toContain(
      "Every quantity carries its unit, in each step and answer as well as the problem: 35 ÷ 7 = 5 stickers, not 5.",
    );
    expect(system).toContain(
      'Where the worked example heads off the misconception, say so in "misconceptionRef".',
    );
    // Nothing about questions: no count, tier, exit, option, demand, forms or keyIdeaRefs rule.
    expect(system.split("question").length - 1).toBe(1); // the lane line only
    for (const gone of [
      "exit",
      "tier",
      "distractor",
      "demand",
      "forms",
      "keyIdeaRefs",
      "stem",
      "reasoning",
    ]) {
      expect(system.toLowerCase()).not.toContain(gone);
    }
    expect(system).toContain(
      `Length limits (characters): statement, belief and step ${SPEC_LIMITS.item}; explanation, example, problem and correction ${SPEC_LIMITS.body}; term ${SPEC_LIMITS.term}; definition ${SPEC_LIMITS.definition}; answer ${SPEC_LIMITS.answer}.`,
    );
    // The sketch is v14's without its `questions` list; `misconceptionRef` stays out of it (v7).
    expect(TEACH_SHAPE_SKETCH).not.toContain("questions");
    expect(TEACH_SHAPE_SKETCH).not.toContain("misconceptionRef");
    expect(system).toContain(TEACH_SHAPE_SKETCH);
    expect(system.split("objectiveRefs").length - 1).toBe(2);
  });

  test("the user turn is v14's, with the task line renamed", () => {
    const rendered = planTeachObjectivePrompt.user(SAMPLE);
    expect(rendered).not.toMatch(/Lesson length|minutes/);
    expect(rendered).toContain(
      "Objectives of the lesson, by index:\n  0: Explain why the Romans invaded",
    );
    expect(rendered).toContain(
      "Write what the lesson teaches for objective 1: Explain how the Romans changed daily life in Britain",
    );
    expect(rendered).toContain(CURRICULUM_INSTRUCTION);
    const refAt = rendered.indexOf(REFERENCE_INSTRUCTION);
    expect(refAt).toBeGreaterThan(rendered.indexOf(CURRICULUM_INSTRUCTION));
    expect(rendered.slice(refAt)).toContain("- Term: villa");
    // The worked-example line is v14's, on the floored call only (Explain: the reach).
    expect(rendered).toContain("Worked example: none for this objective.");
    expect(planTeachObjectivePrompt.user({ ...SAMPLE, target: 2 })).toContain(
      "Worked example: required for this objective.",
    );
    expect(
      workedExampleLine({ ...SAMPLE, shape: lessonShapeOf({ objectiveVerb: "Recall" }, {}) }),
    ).toBeUndefined();
    // Prior knowledge is rendered once, by the audience block (v2), never under the objectives label.
    const covered = planTeachObjectivePrompt.user({
      ...SAMPLE,
      audience: { ...SAMPLE.audience, classContext: { priorKnowledge: "the Roman army" } },
      priorKnowledge: "the Roman army",
    });
    expect(covered.split("the Roman army")).toHaveLength(2);
    expect(covered).toContain("Prior knowledge: the Roman army");
    expect(covered).not.toContain(PRIOR_KNOWLEDGE_LABEL);
    // The starter's questions (C1), labelled as earlier learning, only when given.
    expect(rendered).not.toContain("Starter (earlier learning");
    expect(
      planTeachObjectivePrompt.user({
        ...SAMPLE,
        retrieval: [{ question: "What did Roman soldiers carry?", answer: "A shield" }],
      }),
    ).toContain(
      "Starter (earlier learning, not this lesson):\n  - What did Roman soldiers carry? — A shield",
    );
    const bare = planTeachObjectivePrompt.user({
      ...SAMPLE,
      curriculum: undefined,
      reference: undefined,
    });
    expect(bare).not.toContain(CURRICULUM_INSTRUCTION);
    expect(bare).not.toContain("Reference facts");
  });

  test("the schema is v14's four lists with v14's counts and caps", () => {
    const parse = (value: unknown) => PlanTeachObjectiveOutputSchema.safeParse(value).success;
    expect(parse(taught())).toBe(true);
    expect(parse(taught({ vocabulary: [], workedExamples: [] }))).toBe(true);
    expect(parse(taught({ keyIdeas: [] }))).toBe(false);
    expect(parse(taught({ keyIdeas: [KEY_IDEA, KEY_IDEA, KEY_IDEA] }))).toBe(false);
    expect(parse(taught({ misconceptions: [] }))).toBe(false);
    expect(parse(taught({ misconceptions: [MISCONCEPTION, MISCONCEPTION] }))).toBe(false);
    expect(parse(taught({ vocabulary: [VOCABULARY, VOCABULARY, VOCABULARY] }))).toBe(false);
    expect(parse(taught({ workedExamples: [WORKED_EXAMPLE, WORKED_EXAMPLE] }))).toBe(false);
    // A `questions` list is an invented list here: the outer object is strict.
    expect(parse({ ...taught(), questions: [] })).toBe(false);
    expect(parse(taught({ keyIdeas: [{ ...KEY_IDEA, statement: "x".repeat(161) }] }))).toBe(false);
    const stripped = PlanTeachObjectiveOutputSchema.safeParse(
      taught({ keyIdeas: [{ ...KEY_IDEA, objectiveRefs: [{ type: "objective", index: 0 }] }] }),
    );
    expect(stripped.success && stripped.data.keyIdeas[0]).toEqual(KEY_IDEA);
    // Key order is v14's, so a merged item is byte-for-byte what the facts call would have written.
    const keys = PlanTeachObjectiveOutputSchema.keyof().options;
    expect(keys).toEqual(["keyIdeas", "misconceptions", "vocabulary", "workedExamples"]);
  });

  test("the per-call schema floors the worked example as v14 does, bounds refs, and softens caps only", () => {
    const none = taught({ workedExamples: [] });
    const at = (target: number) => ({ ...SAMPLE, target });
    expect(planTeachObjectiveOutputSchemaFor(at(2)).safeParse(none).success).toBe(false);
    expect(planTeachObjectiveOutputSchemaFor(at(2), { soft: true }).safeParse(none).success).toBe(
      false,
    );
    expect(planTeachObjectiveOutputSchemaFor(at(1)).safeParse(none).success).toBe(true);
    const beyond = taught({
      workedExamples: [{ ...WORKED_EXAMPLE, objectiveRefs: [{ type: "objective", index: 3 }] }],
    });
    expect(PlanTeachObjectiveOutputSchema.safeParse(beyond).success).toBe(true);
    expect(planTeachObjectiveOutputSchemaFor(at(1)).safeParse(beyond).success).toBe(false);
    const long = taught({
      workedExamples: [{ ...WORKED_EXAMPLE, answer: "x".repeat(SPEC_LIMITS.answer + 40) }],
    });
    expect(planTeachObjectiveOutputSchemaFor(at(1)).safeParse(long).success).toBe(false);
    expect(planTeachObjectiveOutputSchemaFor(at(1), { soft: true }).safeParse(long).success).toBe(
      true,
    );
    expect(
      planTeachObjectiveOutputSchemaFor(at(1), { soft: true }).safeParse(
        taught({ vocabulary: [{ ...VOCABULARY, definition: "  " }] }),
      ).success,
    ).toBe(false);
  });
});
