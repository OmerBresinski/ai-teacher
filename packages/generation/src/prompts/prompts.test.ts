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
  "check-input": { topic: brief.topic, answers: brief.answers, audience: brief.audience },
  "plan-skeleton": brief,
  "plan-facts": { ...brief, skeleton: FIXTURES.planSkeleton },
  "verify-facts": { audience, topic: brief.topic, facts },
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
  "pick-or-requery-photo": {
    topic: brief.topic,
    answers: brief.answers,
    lessonTitle: "States of matter",
    audience,
    objectives: ["Describe the three states of matter"],
    vocabulary: ["particle", "evaporation"],
    slideText: "Ice melts into water when heated.",
    subject: "melting ice",
    mustShow: "water and ice together",
    queries: ["melting ice", "melting"],
    candidates: [
      { id: "1", alt: "Ice cubes melting on a wooden table" },
      { id: "2", alt: "A dentist examining a patient" },
    ],
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
  "check-input": {
    version: "check-input.v3",
    hash: "bed12ac4b597d3498293a741964a456f6e0c531aa49acdde2e20809a19e9a6f5",
  },
  "plan-skeleton": {
    version: "plan-skeleton.v6",
    hash: "ec62b3d86918d27a22ce3ad9d5c73d7a0be1737b3661caa080b393c82bc30476",
  },
  "plan-facts": {
    version: "plan-facts.v4",
    hash: "13e6c3305e205c3901509ed5552d92b5810f80376bcb355441910bb76217f3c7",
  },
  "verify-facts": {
    version: "verify-facts.v1",
    hash: "3d78a0d2f29bdddc5d0d5e83a785143d6c0b795da03f0b08b13d0cc965926748",
  },
  "generate-slide": {
    version: "generate-slide.v5",
    hash: "414f0148f4a6fd63f9887a7a48bd6b9759d15d6afc47638a7037e7f2f1f237d0",
  },
  "generate-worksheet": {
    version: "generate-worksheet.v4",
    hash: "833d99e9fb76b620bc0a9420b44c50c36f24e1d6d907486d0f46a5811bd26c9b",
  },
  "pick-or-requery-photo": {
    version: "pick-or-requery-photo.v2",
    hash: "ea854cc39411f363a9dd5fe5e431e5a2d3d6b0057e4ccbfd1e387068eea44f4f",
  },
  evaluate: {
    version: "evaluate.v2",
    hash: "37513673804ae3edb1eba97dc16d3d37f89af3cbd8b8607c498500a6d5d34382",
  },
  repair: {
    version: "repair.v2",
    hash: "72f2192b2ddc98b065fbf5dddd78f53247d9cddb539d40c54638d07859e23686",
  },
  cascade: {
    version: "cascade.v2",
    hash: "cb2a59345961aef8ca048fc5dc4a7b6dd0637ba82381c60a410e82a034ccb28d",
  },
  regenerate: {
    version: "regenerate.v2",
    hash: "453859a1e9e81f6a15349f5232372ee1dbd51fe6a02f8f2c1ea1648a8213685c",
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
