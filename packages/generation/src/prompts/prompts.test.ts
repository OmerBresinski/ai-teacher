import { describe, expect, test } from "bun:test";
import { lessonShapeOf } from "../shapes";
import { assignFactIds } from "../specs";
import { audienceOf } from "../stages/shared";
import { FIXTURES, sampleBriefLesson } from "../testing";
import { PROMPT_VERSIONS, PROMPTS, type PromptName, promptHash } from "./index";
import { planSkeletonPrompt } from "./plan-skeleton";

/*
 * ADR 0025 §17: every prompt's wording is pinned to its version. Change the text → change the
 * version → update the hash here. A wording change without a bump fails this file. The hash covers
 * the rendered user turn too, so a change to the sample inputs below (the plan fixtures, since
 * TEACH-229 eleven outline entries) re-pins every prompt that renders the facts without a bump.
 */

const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
const brief = {
  topic: "States of matter",
  durationMin: 60,
  audience: audienceOf(sampleBriefLesson()),
  sourceTexts: [],
  answers: { q1: "yes" },
  /** Explain / New to it: the cell with the most Shape sentences. */
  shape: lessonShapeOf(
    { objectiveVerb: "Explain states of matter", priorConfidence: "New to it" },
    { yearGroup: "Year 8" },
  ),
};
const audience = audienceOf(sampleBriefLesson());

export const SAMPLE_INPUTS: Record<PromptName, unknown> = {
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
  "shortlist-photos": {
    topic: brief.topic,
    subject: "melting ice",
    mustShow: ["ice", "liquid water"],
    purpose: "observe",
    candidates: [
      { id: "1", alt: "Ice cubes melting on a wooden table" },
      { id: "2", alt: "A dentist examining a patient" },
    ],
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
    version: "plan-skeleton.v12",
    hash: "fef032357e8292aa07c82b7a4d74aa16e4b6cc348d676c4e9a17473842c687b2",
  },
  "plan-facts": {
    version: "plan-facts.v6",
    hash: "040d10ec64718a9c2711496ba22d8f74a39cd4e6274b79ccc2ffa06313706698",
  },
  "verify-facts": {
    version: "verify-facts.v1",
    hash: "269d0d36bc62828b6e101b686d99fb3925182139ec2adbf86034f9d272398252",
  },
  "generate-slide": {
    version: "generate-slide.v8",
    hash: "fb0e73a3cf5d060aa6bab2c4c30031d56cd6a42516e41a026430f776cf39ec5d",
  },
  "generate-worksheet": {
    version: "generate-worksheet.v5",
    hash: "06364e30395e7e2a59c5f1a875d87765d436389f28830c0fbff505ec1f19f345",
  },
  "shortlist-photos": {
    version: "shortlist-photos.v1",
    hash: "bf8fb22fe9ee429ca0ddba567f8fa96a1a31ab997cd93adfd603f33dc0971aaf",
  },
  "pick-or-requery-photo": {
    version: "pick-or-requery-photo.v5",
    hash: "6b04f791296e1b07787530676e8b74887382a9bc9102ba23ae66ceece65341f5",
  },
  evaluate: {
    version: "evaluate.v4",
    hash: "6f4ed075c06072645f8e1de21caedd382398cd6fdf4a0b5260f3ce56d24a8f13",
  },
  repair: {
    version: "repair.v8",
    hash: "8df7121fe6a273df27fd19f087981018163bae505f7be44bb7573b53b44e0697",
  },
  "repair-fact": {
    version: "repair-fact.v2",
    hash: "8f156fb5f6d9ad596b271de7d50a2f1ba500a75e1e7b63855bd2ff135a3ab9f6",
  },
  cascade: {
    version: "cascade.v2",
    hash: "8111e79f21a141c7947e8c148d7a1fdb8956764cd1ea53d41ffda729851df476",
  },
  regenerate: {
    version: "regenerate.v2",
    hash: "53cd60826e8944cd65e473c1500fb50c9493ed3822c32105f3c652a269be0dd1",
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

  test("TEACH-229 row 6: the Shape block reaches both Plan prompts; the raw answers do not", () => {
    const skeleton = PROMPTS["plan-skeleton"].user(SAMPLE_INPUTS["plan-skeleton"] as never);
    expect(skeleton).toContain("Shape:");
    expect(skeleton).toContain("This is an Explain lesson for a class new to the topic.");
    expect(skeleton).toContain(
      "The first explain-phase slide is a content slide that defines the topic and names two or three examples.",
    );
    expect(skeleton).toContain(
      "Include at least one of each: worked-example, open-response, vocabulary.",
    );
    // A revisiting class has no definition slide, so the content sentence asks for mechanism only.
    const revisiting = PROMPTS["plan-skeleton"].user({
      ...(SAMPLE_INPUTS["plan-skeleton"] as object),
      shape: lessonShapeOf({ objectiveVerb: "Explain x", priorConfidence: "Revisiting" }),
    } as never);
    expect(revisiting).toContain("revisiting the topic, so no definition slide");
    expect(revisiting).toContain(
      "At least 2 content slides, each explaining one mechanism (how or why).",
    );
    expect(revisiting).not.toContain("the definition first");
    expect(skeleton).toContain("Explain slides take at least 40% of the minutes.");
    expect(skeleton).toContain(
      "Confront the misconception on a true-false slide or as a multiple-choice distractor.",
    );
    expect(skeleton).not.toContain("The teacher also said");
    expect(skeleton).not.toContain("Question tiers");
    // The facts call adds the tier target from the shape's weights (Explain / New: 5 / 5 / 2).
    const facts = PROMPTS["plan-facts"].user(SAMPLE_INPUTS["plan-facts"] as never);
    expect(facts).toContain("This is an Explain lesson for a class new to the topic.");
    expect(facts).toContain("Question tiers: 5 easy, 5 core, 2 stretch (at least 12 in all).");
    // TEACH-238: the system prompt asks for the photographable flag; the user turn is unchanged.
    expect(planSkeletonPrompt.system).toContain('"photographable": { "yes", "why"');
    expect(skeleton).not.toContain("photographable");
    // The prompt's own example has the default shape: a content slide opens the explain phase.
    const example = /"outline": (\[[\s\S]*?\n {2}\])/.exec(planSkeletonPrompt.system)?.[1];
    if (!example) throw new Error("no example outline in the system prompt");
    const outline = JSON.parse(example) as { kind: string; phase?: string }[];
    expect(outline.find((e) => e.phase === "explain")?.kind).toBe("content");
    expect(outline.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["open-response", "worked-example"]),
    );
  });

  test("the audience and fact ids reach the user prompt", () => {
    const text = PROMPTS["generate-slide"].user(SAMPLE_INPUTS["generate-slide"] as never);
    expect(text).toContain("Year 8");
    expect(text).toContain("o1:");
    expect(text).toContain('kind "vocabulary"');
  });
});
