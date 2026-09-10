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
    referenced: facts,
    entry: facts.outline[3],
    position: { index: 4, total: 10 },
    neighbours: { previous: "Hooks the topic", next: "Explains the particle model" },
    reservedStems: ["What is a particle?"],
    phase: "explain",
    audience,
    vocabularySlots: 4,
    lessonTitle: "States of matter",
  },
  "generate-worksheet": {
    objectives: facts.objectives,
    keyIdeas: facts.keyIdeas ?? [],
    misconceptions: facts.misconceptions,
    pool: facts.questions.filter((q) => q.use === "worksheet" || q.use === "any"),
    reservedStems: ["In which state of matter are the particles furthest apart?"],
    pitch: facts.pitch,
    audience,
    lessonTitle: "States of matter",
  },
  "pick-or-requery-photo": {
    topic: brief.topic,
    answers: brief.answers,
    lessonTitle: "States of matter",
    audience,
    objectives: ["Describe the three states of matter"],
    vocabulary: ["particle", "evaporation"],
    slideBrief: "Shows ice melting into water when heated.",
    subject: "melting ice",
    mustShow: ["ice", "liquid water"],
    purpose: "observe",
    queries: ["melting ice", "melting"],
    candidates: [
      { id: "1", alt: "Ice cubes melting on a wooden table", thumbnail: "https://x/1.jpg" },
      { id: "2", alt: "A dentist examining a patient", thumbnail: "https://x/2.jpg" },
    ],
  },
  evaluate: {
    facts,
    audience,
    slides: [{ id: "s1", kind: "content", text: "The particle model", notes: "Ask why." }],
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
        evidence: "Which state?",
      },
    ],
    shape: 'a "multiple-choice" slide spec',
  },
  "repair-fact": {
    audience,
    facts,
    factId: "v1",
    fields: ["term", "definition"],
    findings: [{ message: "Not the accepted term.", evidence: "Particle" }],
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
    version: "plan-skeleton.v8",
    hash: "678e98cbdae612dee5c40046cb8a28f5cfec2cb713c6b73f8fcc5fb60e5b32ea",
  },
  "plan-facts": {
    version: "plan-facts.v5",
    hash: "c45c07097c8a916b8151007d896b1d90b01505c25adbef95c43f1e8be068bde8",
  },
  "verify-facts": {
    version: "verify-facts.v1",
    hash: "3d78a0d2f29bdddc5d0d5e83a785143d6c0b795da03f0b08b13d0cc965926748",
  },
  "generate-slide": {
    version: "generate-slide.v8",
    hash: "e6c73979c6d652f5c23786213fa7c10cbe794e87cafc8ee4501808cf6ebfd157",
  },
  "generate-worksheet": {
    version: "generate-worksheet.v5",
    hash: "6c944003c98d57c18bc5fc584f338d8a2e16e8321c18740f98fda13b578fe2a3",
  },
  "pick-or-requery-photo": {
    version: "pick-or-requery-photo.v5",
    hash: "6b04f791296e1b07787530676e8b74887382a9bc9102ba23ae66ceece65341f5",
  },
  evaluate: {
    version: "evaluate.v4",
    hash: "2898eb315cf4afe67d95cbeb88ebb4c3093f57687e9dcf482f03bb2c115a1a37",
  },
  repair: {
    version: "repair.v7",
    hash: "521fc1be7492cf5801f0f964577f5e181ef54788f5d381872d70ee7a4cfbd30e",
  },
  "repair-fact": {
    version: "repair-fact.v2",
    hash: "d59321734b369ba28d90e9d5bfee62c4a8d5846bfc45c11c92032457415086c8",
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
