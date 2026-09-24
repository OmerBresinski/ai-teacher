import { describe, expect, test } from "bun:test";
import { lessonShapeOf } from "../shapes";
import { audienceOf } from "../stages/shared";
import { sampleBriefLesson } from "../testing";
import {
  CURRICULUM_INSTRUCTION,
  type PlanObjectivesInput,
  PlanObjectivesOutputSchema,
  PRIOR_KNOWLEDGE_LABEL,
  planObjectivesOutputSchemaFor,
  planObjectivesPrompt,
} from "./plan-objectives";
import { SOURCE_INSTRUCTION } from "./plan-skeleton";

/*
 * ADR 0025 §17: the prompt's wording is pinned to its version (as `prompts.test.ts` does for the
 * registered prompts). `plan-objectives` is not in the registry until the objectives-first Plan
 * lands, so it is pinned here on its own. A primary sample (Year 4) with a whole unit, so the count
 * rule and the curriculum instruction are both part of the hash.
 */
const audience = audienceOf(sampleBriefLesson());

const PLAN_OBJECTIVES_SAMPLE: PlanObjectivesInput = {
  topic: "The Roman invasion of Britain",
  audience: { ...audience, subject: "History", yearGroup: "Year 4" },
  shape: lessonShapeOf(
    { objectiveVerb: "Explain the Roman invasion of Britain", priorConfidence: "New to it" },
    { yearGroup: "Year 4" },
  ),
  curriculum: {
    text: [
      "Programme of study: the Roman Empire and its impact on Britain.",
      "Unit: The Roman Empire in Britain (6 lessons).",
      "Lesson 1 outcome: I can say where the Roman Empire was and when it began.",
      "Lesson 4 outcome: I can say why Boudica led a revolt.",
      "Key learning points: the Romans invaded Britain in AD 43; roads and towns changed daily life;",
      "Boudica's revolt was defeated in AD 61.",
      "Keywords: empire, invasion, revolt.",
      "Misconception: pupils think the Romans left no trace in Britain.",
    ].join("\n"),
  },
};

const PLAN_OBJECTIVES_PIN: { version: string; hash: string } = {
  version: "plan-objectives.v12",
  hash: "144cc2024cd0c482f440fa550d6668819461dad28dc155a68fb3df804ad5a6f3",
};

describe("plan-objectives", () => {
  test("text hash matches its pinned version", () => {
    const text = `${planObjectivesPrompt.system}\n---\n${planObjectivesPrompt.user(PLAN_OBJECTIVES_SAMPLE)}`;
    const actual: { version: string; hash: string } = {
      version: planObjectivesPrompt.version,
      hash: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
    };
    expect(actual).toEqual(PLAN_OBJECTIVES_PIN);
  });

  test("a curriculum unit is anchored, not copied, and the source instruction stays out", () => {
    const system = planObjectivesPrompt.system;
    /*
     * Provider-neutral and short: it runs on whichever gateway model is cheapest. The budget is
     * an alarm, not a target — a set of rules that will not fit under it wants a second call.
     */
    // v7 (minimalism rubric, 23 Sept 2026) trimmed 409 to 299; v8 303; v9 297; v10 276. The alarm
    // follows it down. v12 (24 Sept) adds the retrieval questions: 346, each clause on a judged
    // failure (see the file header), so the alarm moves up once, by that growth.
    expect(system.trim().split(/\s+/).length).toBeLessThan(360);
    // The house rules' JSON-only line is code's (`call.ts` repairs and validates), so it is gone.
    expect(system).not.toContain("JSON only");
    expect(system).toContain("British English");
    expect(system).toContain("Never invent or include the name of any pupil");
    expect(system).toMatch(/JSON/);
    // No fact ids reach this call, so the house rules' `factRefs` line is left out.
    expect(system).not.toContain("factRefs");
    // The reach ladder (UX ruling draft 81): last at the verb, none above, none over two below.
    expect(system).toContain("The lesson's verb is its reach");
    expect(system).toContain("the last sits at that verb, none above, none over two levels below");
    // The lab check flags banned openers literally and none appeared, so the prompt states only the
    // positive form; the ladder is the prompt's alone. The word limit stands on its bench number:
    // v7 dropped it and 2 of 6 sets ran to 18 and 19 words (v8). The pitch is the house rule's
    // line, so the objective rule does not repeat it (v9).
    expect(system).toContain("starting with one observable verb");
    expect(system).toContain("at most 16 words");
    expect(system).not.toContain("in words the class can read");
    expect(system).not.toMatch(/Never open with|160 characters/);
    // The extract's nature is `CURRICULUM_INSTRUCTION`'s to state, beside the extract; the system
    // keeps only the clause it lacks (span the arc, not lesson 1) and names the anchor field.
    expect(system).toContain("span its arc, not its opening lesson");
    expect(system).toContain('"curriculumAnchor"');
    expect(system).not.toContain("not this lesson's plan");
    // The upload instruction made planners copy the unit's first lesson; it must not be reused.
    expect(system).not.toContain(SOURCE_INSTRUCTION);
    expect(system).not.toContain("treat the material's own sequence");
    const withUnit = planObjectivesPrompt.user(PLAN_OBJECTIVES_SAMPLE);
    expect(withUnit).toContain(CURRICULUM_INSTRUCTION);
    expect(withUnit).toContain("Boudica");
    // Ruling 82: lesson length is no longer a size control, so it is not in this call at all.
    expect(withUnit).not.toContain("Lesson length");
    expect(withUnit).not.toMatch(/minutes/);
    expect(withUnit).not.toContain(SOURCE_INSTRUCTION);
    const without = planObjectivesPrompt.user({ ...PLAN_OBJECTIVES_SAMPLE, curriculum: undefined });
    expect(without).not.toContain(CURRICULUM_INSTRUCTION);
    expect(without).not.toContain("Boudica");
  });

  test("the count comes from the topic: plain numbers in the system, no slide count anywhere", () => {
    // Ruling 81 (rewritten 23 Sept): the topic sets the count, usually two or three (ruling 64: 1-4).
    const system = planObjectivesPrompt.system;
    expect(system).toContain("Give as many objectives as the topic has: usually two or three");
    // v10: "building on each other and sharing its key ideas" named no bench failure (rubric 3).
    expect(system).not.toContain("building on each other");
    expect(system).toContain("one for one tight skill; four only for four distinct parts");
    expect(system).toContain("Never split one idea or add a filler line to make another");
    expect(system).not.toMatch(/slide count|slides\b|ceiling/i);
    expect(system).not.toMatch(/minutes/);
    // A single objective must not be told to open below the reach (the check needs it AT the reach).
    expect(system).toContain("start one level below the reach unless there is only one objective");
  });

  test("the user turn carries no slide count and no count line", () => {
    for (const input of [
      PLAN_OBJECTIVES_SAMPLE,
      { ...PLAN_OBJECTIVES_SAMPLE, curriculum: undefined },
      { ...PLAN_OBJECTIVES_SAMPLE, priorKnowledge: "read Act 1 scenes 1 to 5" },
    ]) {
      const user = planObjectivesPrompt.user(input);
      expect(user).not.toMatch(/\bslides?\b/i);
      expect(user).not.toContain("Number of objectives");
      expect(user).not.toMatch(/Lesson length|minutes/);
      // v11: the output shape is the system's "JSON, in this shape:" line and the format is
      // `call.ts`'s to enforce, so the user turn carries no "Answer with … JSON" line.
      expect(user).not.toMatch(/Answer with|JSON/);
    }
  });

  test("the prior-knowledge line is rendered and the system rule names it", () => {
    // Supplying the fact is half of it; the system must point at the line, or the input is inert.
    expect(planObjectivesPrompt.system).toContain(`"${PRIOR_KNOWLEDGE_LABEL}"`);
    expect(planObjectivesPrompt.system).toContain("keep every objective inside that material");
    // v12: the same sentence feeds the starter, so the label is named once (Luna guide 12).
    expect(planObjectivesPrompt.system).toContain("draw the retrieval questions from it");
    expect(planObjectivesPrompt.system.split(PRIOR_KNOWLEDGE_LABEL).length - 1).toBe(1);
    const covered = planObjectivesPrompt.user({
      ...PLAN_OBJECTIVES_SAMPLE,
      priorKnowledge: "read Act 1 scenes 1 to 5",
    });
    expect(covered).toContain(`${PRIOR_KNOWLEDGE_LABEL}: read Act 1 scenes 1 to 5`);
    expect(planObjectivesPrompt.user(PLAN_OBJECTIVES_SAMPLE)).not.toContain(PRIOR_KNOWLEDGE_LABEL);
  });

  test("the anchor field exists only when an extract was retrieved", () => {
    const plain = { text: "Explain why the Romans invaded Britain" };
    const anchored = { ...plain, curriculumAnchor: "the Roman Empire and its impact on Britain" };
    const parse = (hasCurriculum: boolean, objectives: unknown[]) =>
      planObjectivesOutputSchemaFor(hasCurriculum).safeParse({ objectives }).success;
    // With an extract the anchor is required, so a missing one is a retry, not a silent gap.
    expect(parse(true, [anchored, anchored])).toBe(true);
    expect(parse(true, [anchored, plain])).toBe(false);
    // With none the field does not exist, so it cannot be asked for.
    expect(parse(false, [plain, plain])).toBe(true);
    /*
     * A model that invents the anchor anyway (Luna, 2 of 3 no-source calls) must not cost a ~5 s
     * retry: the no-source objective is a plain object, so the stray key is stripped.
     */
    const stripped = planObjectivesOutputSchemaFor(false).safeParse({
      objectives: [anchored, plain],
    });
    expect(stripped.success).toBe(true);
    expect(stripped.success && stripped.data.objectives[0]).toEqual(plain);
    // Both keep the 1-to-4 bound (ruling 64; one objective for one tight skill is a whole answer).
    expect(parse(false, [plain])).toBe(true);
    expect(parse(true, [anchored])).toBe(true);
    expect(parse(false, [])).toBe(false);
    expect(parse(true, [anchored, anchored, anchored, anchored, anchored])).toBe(false);
  });

  test("retrieval: three prior-knowledge questions for the starter, asked once, optional in the schema", () => {
    /*
     * v12 (round 1 judges): starters built from the lesson's own questions were marked
     * tested-not-taught in 8 of 12 decks. The prose carries the count and the test the judge
     * applies; the sketch carries the slot; the schema pins the count and bounds each string.
     */
    const system = planObjectivesPrompt.system;
    expect(system).toContain("three retrieval questions for its starter");
    expect(system).toContain("answerable before this lesson begins");
    expect(system).toContain('"retrieval": [{ "question"');
    // The count appears once in the prose (the sketch shows one item, as it does for objectives).
    expect(system.match(/three retrieval/g)).toHaveLength(1);
    const q = (n: number) => ({
      question: `Which came first: the Iron Age or the Romans? ${n}`,
      answer: "The Iron Age",
    });
    const one = { text: "Explain why the Romans invaded Britain" };
    const anchored = { ...one, curriculumAnchor: "the Roman Empire and its impact on Britain" };
    const parse = (hasCurriculum: boolean, retrieval?: unknown) =>
      planObjectivesOutputSchemaFor(hasCurriculum).safeParse({
        objectives: [hasCurriculum ? anchored : one],
        ...(retrieval === undefined ? {} : { retrieval }),
      }).success;
    for (const hasCurriculum of [true, false]) {
      // Optional: a recorded set, a from-facts rerun or the bench parses without it.
      expect(parse(hasCurriculum)).toBe(true);
      expect(parse(hasCurriculum, [q(1), q(2), q(3)])).toBe(true);
      // Exactly three: Luna writes to the prose number, so two or four is a retry, not a gap.
      expect(parse(hasCurriculum, [q(1), q(2)])).toBe(false);
      expect(parse(hasCurriculum, [q(1), q(2), q(3), q(4)])).toBe(false);
      // Each item is a question and its answer, both non-empty, nothing else.
      expect(parse(hasCurriculum, [q(1), q(2), { ...q(3), answer: "" }])).toBe(false);
      expect(parse(hasCurriculum, [q(1), q(2), { question: "Which came first?" }])).toBe(false);
      expect(parse(hasCurriculum, [q(1), q(2), { ...q(3), options: ["a"] }])).toBe(false);
    }
    expect(
      PlanObjectivesOutputSchema.safeParse({ objectives: [one], retrieval: [q(1), q(2), q(3)] })
        .success,
    ).toBe(true);
  });

  test("the permissive schema takes 1 to 4 objectives and nothing else", () => {
    const one = { text: "Explain why the Romans invaded Britain" };
    const anchored = { ...one, curriculumAnchor: "the Roman Empire and its impact on Britain" };
    const parse = (objectives: unknown[]) =>
      PlanObjectivesOutputSchema.safeParse({ objectives }).success;
    expect(parse([one, anchored])).toBe(true);
    expect(parse([anchored, anchored, anchored, anchored])).toBe(true);
    expect(parse([one])).toBe(true);
    expect(parse([])).toBe(false);
    expect(parse([one, one, one, one, one])).toBe(false);
    expect(parse([{ ...one, id: "o1" }, one])).toBe(false);
    expect(parse([{ ...one, curriculumAnchor: "x".repeat(161) }, one])).toBe(false);
  });
});
