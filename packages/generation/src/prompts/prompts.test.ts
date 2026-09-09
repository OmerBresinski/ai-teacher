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
    version: "plan-skeleton.v5",
    hash: "3ccd840f54f42faf6c53eca3888dd238a13ccdea8e920f34612d914fa21d81d5",
  },
  "plan-facts": {
    version: "plan-facts.v3",
    hash: "bceccf73b9a30f7a19f48f42ee1c0bbc810aebd82adb0d8083daca6bce70f2e0",
  },
  "generate-slide": {
    version: "generate-slide.v5",
    hash: "a576402042cc7fd5741eba7d0fbfd7878af62d396ef0c2c9b2693a80c2f31179",
  },
  "generate-worksheet": {
    version: "generate-worksheet.v4",
    hash: "27af53556063fc3a54201edc3ea52554c83a07d727446d29aa43ce7e7f5ec1f5",
  },
  "pick-or-requery-photo": {
    version: "pick-or-requery-photo.v2",
    hash: "ea854cc39411f363a9dd5fe5e431e5a2d3d6b0057e4ccbfd1e387068eea44f4f",
  },
  evaluate: {
    version: "evaluate.v2",
    hash: "cfc2def8594c4bdf6eef7b1d2c66e564e2d15bc7fca6a3d4496fa1c7e431941f",
  },
  repair: {
    version: "repair.v2",
    hash: "c5daa1ec876b4629130f83bce2b0b1b8e954baf867fc2553811cfbcecf9e23e1",
  },
  cascade: {
    version: "cascade.v2",
    hash: "11be5f91ba0b1bff67db4dd692ccb9319a5f8cf368f22d624985b0a59182d99c",
  },
  regenerate: {
    version: "regenerate.v2",
    hash: "99fa070108751ddbae761f0afb52a2540ba12ef09393cbfff690a1dfd8017aef",
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
