import { describe, expect, test } from "bun:test";
import { assignFactIds } from "../specs";
import { audienceOf } from "../stages/shared";
import { FIXTURES, sampleBriefLesson } from "../testing";
import { PROMPT_VERSIONS, PROMPTS, type PromptName, promptHash } from "./index";

/*
 * ADR 0025 §17: every prompt's wording is pinned to its version. Change the text → change the
 * version → update the hash here. A wording change without a bump fails this file.
 */

const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
const brief = {
  topic: "States of matter",
  durationMin: 60,
  audience: audienceOf(sampleBriefLesson()),
  sourceTexts: [],
  answers: { q1: "yes" },
};
const audience = audienceOf(sampleBriefLesson());

const SAMPLE_INPUTS: Record<PromptName, unknown> = {
  "plan-skeleton": brief,
  "plan-facts": { ...brief, skeleton: FIXTURES.planSkeleton },
  "generate-slide": {
    facts,
    entry: facts.outline[3],
    position: { index: 4, total: 10 },
    previousSlideText: "Do now",
    audience,
    vocabularySlots: 4,
    lessonTitle: "States of matter",
  },
  "generate-worksheet": {
    facts,
    audience,
    lessonTitle: "States of matter",
    slideTexts: ["Do now", "Key vocabulary"],
  },
  evaluate: {
    facts,
    audience,
    slides: [{ id: "s1", kind: "content", text: "The particle model" }],
    blocks: [{ id: "b1", type: "question", text: "Why?\nAnswer: Because." }],
  },
  repair: {
    facts,
    audience,
    target: { kind: "slide", slideKind: "multiple-choice", slideId: "s7", text: "Which state?" },
    findings: [
      {
        check: "answer-correctness",
        severity: "error",
        target: { slideId: "s7" },
        message: "Wrong.",
      },
    ],
    shape: 'a "multiple-choice" slide spec',
  },
  cascade: {
    facts,
    audience,
    target: { kind: "block", blockType: "question", blockId: "b1", text: "Why?\nAnswer: Because." },
    shape: 'a "question" block spec',
    changedFactIds: ["o1"],
  },
  regenerate: {
    facts,
    audience,
    target: { kind: "slide", slideKind: "content", slideId: "s5", text: "The particle model" },
    shape: 'a "content" slide spec',
    instruction: "simpler words",
  },
};

const PINNED: Record<PromptName, { version: string; hash: string }> = {
  "plan-skeleton": {
    version: "plan-skeleton.v1",
    hash: "2df135d0804a8cbedf796e3e5b461e5d50433e0c715a52cec89ce9122e643fe9",
  },
  "plan-facts": {
    version: "plan-facts.v1",
    hash: "37bb4178f67f3e2099007a46cb556346516c8915488f6c5dcf5c3654c7f87f72",
  },
  "generate-slide": {
    version: "generate-slide.v2",
    // Re-pinned in TEACH-138 without a bump: the wording is unchanged, the sample `entry`
    // (`facts.outline[3]`) gained an objective ref when the fixture plan was split.
    hash: "9b6b5b037c2fa7bb56697a4870afa327d23d9e2593606ff205a20b2134096a10",
  },
  "generate-worksheet": {
    version: "generate-worksheet.v3",
    hash: "d1d5fc280e99447afc89ef63b35b3ebcbc708b604d70fed39ba71bc4ca8f7814",
  },
  evaluate: {
    version: "evaluate.v1",
    hash: "82c1332b6a4d17927598c3eeaefc477d866602d8a814d66d2a07dc9409f24083",
  },
  repair: {
    version: "repair.v1",
    hash: "69044a8fb8d5c888ef35ae3d5910a23f82b8446af175dd073c01952648e9666b",
  },
  cascade: {
    version: "cascade.v1",
    hash: "283d85851eb9ed2907f3a84cea214e0ce883438deab5c1e5607416a98dc113d6",
  },
  regenerate: {
    version: "regenerate.v1",
    hash: "f0e545aa74a5b033d8a199d7f891b55f31efe335d91c116e8889f99444c9d8bc",
  },
};

describe("prompt versions", () => {
  test.each(Object.keys(PROMPTS) as PromptName[])(
    "%s: text hash matches its pinned version",
    (name) => {
      expect(PROMPT_VERSIONS[name] as string).toBe(PINNED[name].version);
      const actual: { version: string; hash: string } = {
        version: PROMPTS[name].version,
        hash: promptHash(name, SAMPLE_INPUTS[name]),
      };
      expect(actual).toEqual(PINNED[name]);
    },
  );

  test("every prompt states the house rules and asks for JSON", () => {
    for (const prompt of Object.values(PROMPTS)) {
      expect(prompt.system).toContain("British English");
      expect(prompt.system).toContain("Never invent or include the name of any pupil");
      expect(prompt.system).toMatch(/JSON/);
    }
  });

  test("the audience and fact ids reach the user prompt", () => {
    const text = PROMPTS["generate-slide"].user(SAMPLE_INPUTS["generate-slide"] as never);
    expect(text).toContain("Year 8");
    expect(text).toContain("o1:");
    expect(text).toContain('kind "vocabulary"');
  });
});
