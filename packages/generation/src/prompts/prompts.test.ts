import { describe, expect, test } from "bun:test";
import { lessonShapeOf } from "../shapes";
import { assignFactIds } from "../specs";
import { audienceOf } from "../stages/shared";
import { FIXTURES, sampleBriefLesson } from "../testing";
import {
  PROMPT_VERSIONS,
  PROMPTS,
  type PromptName,
  promptHash,
  VERB_WRITING,
  verbBlock,
} from "./index";
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
/** The verb and confidence the writers and the reviewer are told (TEACH-230). */
const shape = { verb: brief.shape.verb, confidence: brief.shape.confidence };

export const SAMPLE_INPUTS: Record<PromptName, unknown> = {
  "check-input": { topic: brief.topic, answers: brief.answers, audience: brief.audience },
  "plan-skeleton": brief,
  "plan-facts": { ...brief, skeleton: FIXTURES.planSkeleton },
  "verify-facts": { audience, topic: brief.topic, facts },
  "generate-slide": {
    referenced: facts,
    entry: facts.outline[3],
    shape,
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
    shape,
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
    shape,
    slides: [{ id: "s1", kind: "content", text: "The particle model", notes: "Ask why." }],
    blocks: [{ id: "b1", type: "question", text: "Why?\nAnswer: Because." }],
  },
  repair: {
    facts,
    audience,
    lessonShape: shape,
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
    version: "plan-skeleton.v15",
    hash: "703eadbca5dd93b53ae98d8032754ff31f0e100e25055b8854cda2ecf414f75a",
  },
  "plan-facts": {
    version: "plan-facts.v7",
    hash: "7f31a4e4e8eb79631c947269f28693b17325bfd076e30706caf30dde6992eeb9",
  },
  "verify-facts": {
    version: "verify-facts.v1",
    hash: "269d0d36bc62828b6e101b686d99fb3925182139ec2adbf86034f9d272398252",
  },
  "generate-slide": {
    version: "generate-slide.v15",
    hash: "8a9338687c9ca58d9058e81fe2217450064f5dbbdea0693d084a51d7160dd8cb",
  },
  "generate-worksheet": {
    version: "generate-worksheet.v7",
    hash: "3c7424a8269d370b008865a433ac2e60693dd07fa1bb06504b43942e00916ee5",
  },
  "shortlist-photos": {
    version: "shortlist-photos.v2",
    hash: "1bca44f4c61f12113e44be1ec038d596c4dba84dafd8cbb0ffa0807240f2d081",
  },
  "pick-or-requery-photo": {
    version: "pick-or-requery-photo.v6",
    hash: "f3ac118e19b5ff1051618ca4823658c778e38d0c076d292c3e15b8a5cd9b6b26",
  },
  evaluate: {
    version: "evaluate.v5",
    hash: "57eb53cba998e0aa7b9049deb74374d0d1a92986a5221e271c3f9dd0b117e7b4",
  },
  repair: {
    version: "repair.v9",
    hash: "927d26133cc0ed93912b003f05660f68f970b36f326b58b18d421f3f1523045f",
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
    // TEACH-240: mustShow names what an ordinary photograph shows; our own example used to be "front teeth".
    expect(planSkeletonPrompt.system).toContain("a stranger would take it");
    expect(planSkeletonPrompt.system).not.toContain('"front teeth"');
    expect(planSkeletonPrompt.system).not.toContain('"rodent incisors"');
    // TEACH-242: two or three different external features, so "at least one visible" has room.
    expect(planSkeletonPrompt.system).toContain("two or three concrete things");
    expect(planSkeletonPrompt.system).toContain("at least one of them");
    expect(planSkeletonPrompt.system).not.toContain("one or two concrete things");
    // The example follows its own rule: three external items, no close-up in the subject.
    const pictured = outlineOfExample().find((e) => e.kind === "image-text") as
      | { imageBrief?: { subject: string; mustShow: string[] } }
      | undefined;
    expect(pictured?.imageBrief?.mustShow).toEqual(["open flower head", "petals", "stem"]);
    expect(pictured?.imageBrief?.subject).not.toContain("close-up");
    // TEACH-238: the system prompt asks for the photographable flag; the user turn is unchanged.
    expect(planSkeletonPrompt.system).toContain('"photographable": { "yes", "why"');
    expect(skeleton).not.toContain("photographable");
    // The prompt's own example has the default shape: a content slide opens the explain phase.
    const outline = outlineOfExample();
    expect(outline.find((e) => e.phase === "explain")?.kind).toBe("content");
    expect(outline.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["open-response", "worked-example"]),
    );
  });

  test("TEACH-245: the slide writer keeps the last step, the terms definitions need, and asks what the slide does not say", () => {
    const system = PROMPTS["generate-slide"].system;
    expect(system).toContain("merge neighbouring steps");
    expect(system).toContain("never drop it");
    expect(system).toContain("not already on the slide");
    // TEACH-246: footnote is for pupils; teacher text belongs in notes.
    expect(system).toContain("`footnote` is one short line pupils read");
    // TEACH-247: steps are capped to what the working card holds.
    expect(system).toContain("each one short line of about 56 characters");
    // TEACH-255: the limits are aims; the schema ceiling is higher and not advertised.
    expect(system).toContain("option ≤ 80");
    expect(system).toContain("term ≤ 60");
    expect(system).toContain("a little over is accepted, one and a half times is not");
    // TEACH-249: the prompt shows what four short steps look like.
    expect(system).toContain("Example for a worked-example slide");
    const shown = /"steps": (\[\s*"[^\]]*\])/.exec(
      system.slice(system.indexOf("Example for a worked-example slide")),
    )?.[1];
    if (!shown) throw new Error("no worked-example steps in the system prompt");
    const steps = JSON.parse(shown) as string[];
    expect(steps).toHaveLength(4);
    for (const step of steps) expect(step.length).toBeLessThanOrEqual(56);
    expect(steps[3]).toMatch(/^So /);
    const vocab = PROMPTS["generate-slide"].user({
      ...(SAMPLE_INPUTS["generate-slide"] as object),
      entry: { kind: "vocabulary", minutes: 5, factRefs: ["v1"] },
      vocabularySlots: 4,
    } as never);
    expect(vocab).toContain("at most 4 vocabulary entries");
    expect(vocab).toContain("keep every term another shown definition uses");
  });

  test("TEACH-241: the judge picks a photo showing at least one required item, not all of them", () => {
    const system = PROMPTS["pick-or-requery-photo"].system;
    expect(system).toContain("at least one");
    expect(system).not.toContain("shows every required item");
    const user = PROMPTS["pick-or-requery-photo"].user(
      SAMPLE_INPUTS["pick-or-requery-photo"] as never,
    );
    expect(user).toContain("at least one must be visible");
    expect(user).not.toContain("all of which must be visible");
  });

  test("TEACH-239: the shortlist asks for the subject only; the required items are the judge's", () => {
    const text = PROMPTS["shortlist-photos"].user(SAMPLE_INPUTS["shortlist-photos"] as never);
    expect(text).toContain("do not reject a caption for not mentioning them");
    expect(text).not.toContain("all of which must be visible");
  });

  /** The example outline embedded in the skeleton system prompt. */
  function outlineOfExample(): { kind: string; phase?: string }[] {
    const example = /"outline": (\[[\s\S]*?\n {2}\])/.exec(planSkeletonPrompt.system)?.[1];
    if (!example) throw new Error("no example outline in the system prompt");
    return JSON.parse(example) as { kind: string; phase?: string }[];
  }

  test("the audience and fact ids reach the user prompt", () => {
    const text = PROMPTS["generate-slide"].user(SAMPLE_INPUTS["generate-slide"] as never);
    expect(text).toContain("Year 8");
    expect(text).toContain("o1:");
    expect(text).toContain('kind "vocabulary"');
  });

  test("TEACH-230 row 1: an Apply content slide is told the Apply paragraph and not the Explain one", () => {
    const apply = lessonShapeOf({
      objectiveVerb: "Apply column addition",
      priorConfidence: "Some prior knowledge",
    });
    const text = PROMPTS["generate-slide"].user({
      ...(SAMPLE_INPUTS["generate-slide"] as object),
      entry: { kind: "content", minutes: 5, factRefs: ["k1"] },
      shape: { verb: apply.verb, confidence: apply.confidence },
    } as never);
    expect(text).toContain("Objective verb: Apply.");
    expect(text).toContain(VERB_WRITING.Apply);
    expect(text).not.toContain(VERB_WRITING.Explain);
    expect(text).not.toContain("This is an Explain lesson");
    expect(text).toContain("The class has some prior knowledge");
    // The default sample is Explain / New to it: its block says so.
    const explain = PROMPTS["generate-slide"].user(SAMPLE_INPUTS["generate-slide"] as never);
    expect(explain).toContain(VERB_WRITING.Explain);
    expect(explain).toContain("The class is new to the topic");
  });

  test("TEACH-230: the verb block reaches the worksheet writer, the reviewer and Repair; Evaluate names verb-fit", () => {
    for (const name of ["generate-worksheet", "evaluate", "repair"] as const) {
      const text = PROMPTS[name].user(SAMPLE_INPUTS[name] as never);
      expect(text).toContain("Objective verb: Explain.");
      expect(text).toContain(VERB_WRITING.Explain);
    }
    expect(PROMPTS.evaluate.system).toContain('"verb-fit"');
    expect(PROMPTS.evaluate.system).toContain(
      "a slide or worksheet block whose task does not serve the objective verb — a Recall lesson asking for a judgement, an Apply lesson with no method, an Explain content slide that lists facts without how or why",
    );
    expect(PROMPTS.evaluate.system).toContain(
      "a slide or block that does what another verb would ask for is a `verb-fit` finding",
    );
    expect(PROMPTS.repair.system).toContain("A verb-fit problem is fixed by changing the task");
    // Every verb has a paragraph naming the four kinds the ticket names.
    for (const paragraph of Object.values(VERB_WRITING)) {
      for (const kind of ["`content`", "`worked-example`", "`exit-ticket`"]) {
        expect(paragraph).toContain(kind);
      }
    }
    for (const verb of ["Explain", "Apply", "Evaluate"] as const) {
      expect(VERB_WRITING[verb]).toContain("`open-response`");
    }
    // Recall forbids open-response (shapes.ts), so its paragraph does not describe one.
    expect(VERB_WRITING.Recall).not.toContain("`open-response`");
  });

  test("TEACH-230: a revisiting Recall class is not told 'no definitions'; the other verbs are", () => {
    const line = (verb: string) =>
      verbBlock(lessonShapeOf({ objectiveVerb: `${verb} x`, priorConfidence: "Revisiting" })).split(
        "\n",
      )[1] ?? "";
    expect(line("Recall")).toContain("has met the definitions: do not re-teach them");
    expect(line("Recall")).toContain("odd one out");
    expect(line("Recall")).not.toContain("no definitions");
    for (const verb of ["Explain", "Apply", "Evaluate"]) {
      expect(line(verb)).toContain(
        "no definitions; go straight to the mechanism, method or judgement",
      );
    }
  });
});
