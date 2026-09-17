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
 * lands, so it is pinned here on its own. A primary sample (Year 4, an hour) with a whole unit, so
 * the count rule and the curriculum instruction are both part of the hash.
 */
const audience = audienceOf(sampleBriefLesson());

const PLAN_OBJECTIVES_SAMPLE: PlanObjectivesInput = {
  topic: "The Roman invasion of Britain",
  durationMin: 60,
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
  version: "plan-objectives.v3",
  hash: "b14415ac66f0ff837be35621c66f6e3d94947fe2993163361773fbc81f6f1b17",
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
    expect(system.trim().split(/\s+/).length).toBeLessThan(410);
    expect(system).toContain("British English");
    expect(system).toContain("Never invent or include the name of any pupil");
    expect(system).toMatch(/JSON/);
    // No fact ids reach this call, so the house rules' `factRefs` line is left out.
    expect(system).not.toContain("factRefs");
    // The reach ladder (UX ruling draft 81): last at the verb, none above, none over two below.
    expect(system).toContain("The lesson's verb is its reach");
    expect(system).toContain("the last sits at that verb, none above, none over two levels below");
    expect(system).toContain('Never open with "understand", "know", "learn"');
    // The upload instruction made planners copy the unit's first lesson; it must not be reused.
    expect(system).not.toContain(SOURCE_INSTRUCTION);
    expect(system).not.toContain("treat the material's own sequence");
    const withUnit = planObjectivesPrompt.user(PLAN_OBJECTIVES_SAMPLE);
    expect(withUnit).toContain(CURRICULUM_INSTRUCTION);
    expect(withUnit).toContain("Boudica");
    expect(withUnit).toContain("Lesson length: 60 minutes");
    expect(withUnit).not.toContain(SOURCE_INSTRUCTION);
    const without = planObjectivesPrompt.user({ ...PLAN_OBJECTIVES_SAMPLE, curriculum: undefined });
    expect(without).not.toContain(CURRICULUM_INSTRUCTION);
    expect(without).not.toContain("Boudica");
  });

  test("the prior-knowledge line is rendered and the system rule names it", () => {
    // Supplying the fact is half of it; the system must point at the line, or the input is inert.
    expect(planObjectivesPrompt.system).toContain(`"${PRIOR_KNOWLEDGE_LABEL}"`);
    expect(planObjectivesPrompt.system).toContain("keep every objective inside that material");
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
    // Both keep the 2-to-4 bound.
    expect(parse(false, [plain])).toBe(false);
    expect(parse(true, [anchored, anchored, anchored, anchored, anchored])).toBe(false);
  });

  test("the permissive schema takes 2 to 4 objectives and nothing else", () => {
    const one = { text: "Explain why the Romans invaded Britain" };
    const anchored = { ...one, curriculumAnchor: "the Roman Empire and its impact on Britain" };
    const parse = (objectives: unknown[]) =>
      PlanObjectivesOutputSchema.safeParse({ objectives }).success;
    expect(parse([one, anchored])).toBe(true);
    expect(parse([anchored, anchored, anchored, anchored])).toBe(true);
    expect(parse([one])).toBe(false);
    expect(parse([one, one, one, one, one])).toBe(false);
    expect(parse([{ ...one, id: "o1" }, one])).toBe(false);
    expect(parse([{ ...one, curriculumAnchor: "x".repeat(161) }, one])).toBe(false);
  });
});
