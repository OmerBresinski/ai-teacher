import { describe, expect, test } from "bun:test";
import { blockSpecSchemaFor, slideSpecSchemaFor } from "@tj/slides";
import { lessonShapeOf } from "../shapes";
import { assignFactIds, PITCH_BOUNDS, WorksheetSpecSchema } from "../specs";
import { audienceOf } from "../stages/shared";
import { FIXTURES, sampleBriefLesson } from "../testing";
import { generateSlidePrompt, ownMisconceptions } from "./generate-slide";
import { generateWorksheetFillPrompt, type WorksheetFill } from "./generate-worksheet-fill";
import { promptHash } from "./hash";
import {
  PROMPT_VERSIONS,
  PROMPTS,
  type PromptName,
  type RepairInput,
  VERB_WRITING,
  verbBlock,
} from "./index";
import { parseBriefPrompt } from "./parse-brief";
import { planFactsPrompt } from "./plan-facts";
import {
  PLAN_FACTS_OBJECTIVE_SAMPLE,
  PLAN_OBJECTIVES_SAMPLE,
  PLAN_QUESTION_SET_SAMPLE,
  PLAN_TEACH_OBJECTIVE_SAMPLE,
} from "./plan-samples";
import { planSkeletonPrompt, SOURCE_INSTRUCTION } from "./plan-skeleton";
import { verifyFactsPrompt } from "./verify-facts";

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
  /** Two Sources (ADR 0027 §6) so the source instruction and locators are part of the hash. */
  sourceTexts: [
    { sourceId: "src1", ref: { page: 3 }, text: "Solids keep their shape; liquids flow." },
    { sourceId: "src2", ref: { section: "Particles" }, text: "Particles vibrate in a solid." },
  ],
  answers: { q1: "yes" },
  /** Explain / New to it: the cell with the most Shape sentences. */
  shape: lessonShapeOf(
    { objectiveVerb: "Explain states of matter", priorConfidence: "New to it" },
    { yearGroup: "Year 8" },
  ),
  /** ADR 0029 item 9: the fixed count and the level are in the hash; pinned objectives are not. */
  slideCount: 10 as const,
  level: "harder" as const,
};
const audience = audienceOf(sampleBriefLesson());
/** The verb and confidence the writers and the reviewer are told (TEACH-230). */
const shape = { verb: brief.shape.verb, confidence: brief.shape.confidence };
/** The whole-sheet writer and the fill writer see the same lesson (ADR 0030 item 3). */
const worksheetInput = {
  objectives: facts.objectives,
  shape,
  keyIdeas: facts.keyIdeas ?? [],
  misconceptions: facts.misconceptions,
  pool: facts.questions.filter((q) => q.use === "worksheet" || q.use === "any"),
  reservedStems: ["In which state of matter are the particles furthest apart?"],
  pitch: facts.pitch,
  audience,
  lessonTitle: "States of matter",
};

export const SAMPLE_INPUTS: Record<PromptName, unknown> = {
  "check-input": { topic: brief.topic, answers: brief.answers, audience: brief.audience },
  "plan-skeleton": brief,
  "plan-facts": { ...brief, skeleton: FIXTURES.planSkeleton },
  "plan-objectives": PLAN_OBJECTIVES_SAMPLE,
  "plan-facts-objective": PLAN_FACTS_OBJECTIVE_SAMPLE,
  "plan-teach-objective": PLAN_TEACH_OBJECTIVE_SAMPLE,
  "plan-question-set": PLAN_QUESTION_SET_SAMPLE,
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
  "generate-worksheet": worksheetInput,
  "generate-worksheet-fill": {
    ...worksheetInput,
    recipe: {
      id: "practise-core",
      job: "practise",
      fillSlots: [
        { index: 2, allowedTypes: ["question", "multiple-choice"], count: [2, 3] },
        { index: 4, allowedTypes: ["fill-gap", "matching"], count: [1, 1] },
      ],
      minutesBudget: 15,
    },
  },
  "parse-brief": {
    text: "Year 8 states of matter, 50 minutes, lower set",
    yearGroups: ["Year 7", "Year 8", "Year 9"],
    subjects: ["Science", "Maths", "English"],
    alreadyKnown: { yearGroup: "Year 8", durationMin: 50 },
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
        check: "verb-fit",
        severity: "warning",
        target: { slideId: "s7" },
        message: "Asks pupils to name, not explain.",
        evidence: "Which state?",
      },
      {
        check: "answer-correctness",
        severity: "error",
        target: { slideId: "s7" },
        message: "Wrong.",
        evidence: "Which state?",
      },
    ],
    shape: 'a "multiple-choice" slide spec',
    context: {
      slides: [
        { position: 5, kind: "content", text: "Solids keep their shape.", why: "taught-earlier" },
        { position: 6, kind: "worked-example", text: "Is ice a solid?", why: "before" },
      ],
    },
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
    version: "check-input.v4",
    hash: "a4f3ff2d86262252006017bc4176e8d7a384fdeeaa87982b32c66a6044c8db69",
  },
  "plan-skeleton": {
    version: "plan-skeleton.v19",
    hash: "7333757394f2391ab9921f089296dc415cabdbd195308ff6ce552ab54453d6a2",
  },
  "plan-facts": {
    version: "plan-facts.v11",
    hash: "a582769329a1e3bc2652808dd41c8fc87c8c68e18b1f6b95d8c46407c44253c3",
  },
  "plan-objectives": {
    version: "plan-objectives.v18",
    hash: "4ce288b25f09eec5f5a6a357bfb931677dcbc5a6d210dad01f9bbc64174308e6",
  },
  "plan-facts-objective": {
    version: "plan-facts-objective.v14",
    hash: "e4a54b63401fa8c49a7de13f30bfd84999f0d2e2dbda8a3525150c40e4985c8b",
  },
  "plan-teach-objective": {
    version: "plan-teach-objective.v3",
    hash: "c74a0723399b8f7cd3c5fc7256bbd9d3345f450b00d48590e6e1f1f970d7fd2c",
  },
  "plan-question-set": {
    version: "plan-question-set.v7",
    hash: "5cf0f133c71c328ce0c72ceb9be2e3b4a93cbc81fb4be0234d9b068c9dce8e64",
  },
  "verify-facts": {
    version: "verify-facts.v6",
    hash: "e80585b89cd1ea9fc83f21b6f193109e72d5e022bef4407ea26ffd6061183e22",
  },
  "generate-slide": {
    // v23 changed only a user-turn block the sample (no `laterQuestions`) does not render.
    version: "generate-slide.v25",
    hash: "e3953495e78f5e8746ca4a39e00004a8756720a703f2503954ca11d5fcc5a072",
  },
  "generate-worksheet": {
    version: "generate-worksheet.v10",
    hash: "a0cd4c974c6ef8701734f2efc73676e98e101c9857f178fd8e9385913ec16a3e",
  },
  "generate-worksheet-fill": {
    version: "generate-worksheet-fill.v2",
    hash: "dcfcd48eb742584bab6a4bab5d25ce9a40fc7aa76de4cea828f2175e11a074b8",
  },
  "parse-brief": {
    version: "parse-brief.v2",
    hash: "b4507f7a3335f4638d0460bfaa95e4bde0df51bebcee9521ba1f7a4f703d9be9",
  },
  "shortlist-photos": {
    version: "shortlist-photos.v3",
    hash: "7fbcbfb66ce32bc9e3c99c189cdf72991c772c79dc6e0dba9360d8dad75e8be6",
  },
  "pick-or-requery-photo": {
    version: "pick-or-requery-photo.v7",
    hash: "5d38c9bafd55fa9938b767a885661963f6e0416bbc571642829eb5735726520f",
  },
  evaluate: {
    version: "evaluate.v8",
    hash: "6207e235c290272a2b5c20309f9ab92655be19f0ca67b18416b8a6998e1d73ff",
  },
  repair: {
    version: "repair.v15",
    hash: "c0f91326d9c84ae43803f8da60a6be30b82683047bf2aa2d31beb402b110b039",
  },
  "repair-fact": {
    version: "repair-fact.v5",
    hash: "c4eb2f681babc21303581384470cbff4e89adb4e06b6d908fa2c2a91e34b14e7",
  },
  cascade: {
    version: "cascade.v4",
    hash: "2ac2c429f2b3dc487829d322366acd6de3a88bc9d96d3e9b503f982fc27766d0",
  },
  regenerate: {
    version: "regenerate.v4",
    hash: "decd8c0815c63c391acb2023b23a89aae83d1e2a886167ca0f238cac03bd5102",
  },
};

describe("prompt versions", () => {
  test("TEACH-258: every embedded slide, block and worksheet example passes its editorial schema", () => {
    // Pretty-printed example() objects have unindented braces; shape sketches are inline.
    const examples = (system: string) =>
      Array.from(
        system.matchAll(/^\{\n[\s\S]*?^\}/gm),
        (match) => JSON.parse(match[0]) as Record<string, unknown>,
      );
    for (const name of ["generate-slide", "repair"] as const) {
      const shown = examples(PROMPTS[name].system);
      expect(shown).toHaveLength(3);
      for (const spec of shown) {
        const schema =
          typeof spec.kind === "string"
            ? slideSpecSchemaFor(spec.kind)
            : blockSpecSchemaFor(String(spec.type));
        expect(schema).toBeDefined();
        expect(() => schema?.parse(spec), `${name}: ${spec.kind ?? spec.type}`).not.toThrow();
      }
    }
    const sheets = examples(PROMPTS["generate-worksheet"].system);
    expect(sheets).toHaveLength(1);
    expect(WorksheetSpecSchema.safeParse(sheets[0]).success).toBe(true);
    // The fill example and the fill fixture are block specs per slot (ADR 0030 item 3).
    const fills = examples(PROMPTS["generate-worksheet-fill"].system) as unknown as WorksheetFill[];
    expect(fills).toHaveLength(1);
    for (const fill of [fills[0] as WorksheetFill, FIXTURES.worksheetFill]) {
      for (const slot of fill.slots) {
        expect(slot.blocks.length).toBeGreaterThan(0);
        for (const block of slot.blocks) {
          const schema = blockSpecSchemaFor(block.type);
          expect(schema).toBeDefined();
          expect(() => schema?.parse(block), block.type).not.toThrow();
        }
      }
    }
  });

  test("TEACH-258: examples replace prose within each prompt's baseline word budget", () => {
    const budgets = {
      // v19 was 990 words; v20 (minimalism rubric, 23 Sep 2026) is 956. v22 (+15: the two-key-idea
      // content rule and its 60-word body) is 971 and must stay under this. v25 (the build-up
      // order, luna-direct FM3) is 979.
      "generate-slide": 980,
      "generate-worksheet": 639,
      "generate-worksheet-fill": 639,
      // v13 was 415 words. v14 (lab round 1, +97: errors first and answer lines kept, once-in-the-
      // lesson against the slides shown, taught-earlier scope, verb-fit at the class's level) is 512; the review wording (errors, then warnings) makes it 515.
      repair: 520,
    } as const;
    for (const name of Object.keys(budgets) as (keyof typeof budgets)[]) {
      expect(PROMPTS[name].system.trim().split(/\s+/).length, name).toBeLessThan(budgets[name]);
    }
  });

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

  test("plan prompts render the source instruction and locators only when sources exist", () => {
    const withSources = planSkeletonPrompt.user(brief);
    expect(withSources.split(SOURCE_INSTRUCTION)).toHaveLength(2);
    expect(withSources).toContain("[src1 p.3] Solids keep their shape");
    expect(withSources).toContain("[src2 §Particles] Particles vibrate");
    const without = planSkeletonPrompt.user({ ...brief, sourceTexts: [] });
    expect(without).not.toContain(SOURCE_INSTRUCTION);
    expect(without).not.toContain("[src");
    expect(planFactsPrompt.user({ ...brief, skeleton: FIXTURES.planSkeleton })).toContain(
      "[src1 p.3]",
    );
  });

  test("TEACH-67: the skeleton takes the fixed slide count, the level and the pinned objectives", () => {
    const RANGE =
      "Give 8–12 outline slides, counting the title and objectives slides; fewer for a lesson much shorter than an hour.";
    const fixed = planSkeletonPrompt.user({ ...brief, slideCount: 8 });
    expect(fixed).toContain(
      "The outline has exactly 8 slides, counting the title and objectives slides.",
    );
    expect(fixed).not.toContain(RANGE);
    expect(fixed).toContain("Give 1–4 objectives.");
    const open = planSkeletonPrompt.user({ ...brief, slideCount: undefined, level: undefined });
    expect(open).toContain(RANGE);
    expect(open).not.toContain("exactly");
    expect(open).not.toContain("Level:");
    // The level is a word in the audience, never a number (ruling 74), and both Plan calls see it.
    expect(fixed).toContain("Level: harder — pitch one band above");
    expect(planFactsPrompt.user({ ...brief, skeleton: FIXTURES.planSkeleton })).toContain(
      "Level: harder — pitch one band above",
    );
    expect(planSkeletonPrompt.user({ ...brief, level: "easier" })).toContain(
      "Level: easier — pitch one band below",
    );
    // Pinned objectives (ADR 0029 item 8): copied verbatim, in order, none proposed.
    const pinned = planSkeletonPrompt.user({
      ...brief,
      givenObjectives: [
        { id: "o1", text: "Explain how particles move in each state" },
        { id: "o2", text: "Predict what heating does to a solid" },
      ],
    });
    expect(pinned).toContain("Objectives, fixed by the teacher (id: text):");
    expect(pinned).toContain(
      "  o1: Explain how particles move in each state\n  o2: Predict what heating does to a solid",
    );
    expect(pinned).toContain(
      'Copy these objectives into "learningObjectives" verbatim, in this order, and propose no others.',
    );
    expect(pinned).not.toContain("Give 1–4 objectives.");
    expect(pinned).toContain("exactly 10 slides");
    expect(planSkeletonPrompt.system).toContain("copy them exactly as written");
    expect(planSkeletonPrompt.system).not.toContain("Give 1–4 objectives and 8–12 outline slides");
  });

  test("TEACH-67: the facts call is told the one-band nudge with the schema's bounds", () => {
    const withSkeleton = { ...brief, skeleton: FIXTURES.planSkeleton };
    const harder = planFactsPrompt.user(withSkeleton);
    expect(harder).toContain(
      'Pitch: the level is "harder", so raise "readingAgeTarget" and "sentenceLengthMax" by one band',
    );
    expect(harder).toContain(
      "Stay within 5–18 for the reading age and 6–30 for the sentence length.",
    );
    expect(PITCH_BOUNDS).toEqual({ readingAge: [5, 18], sentenceLength: [6, 30] });
    expect(planFactsPrompt.user({ ...withSkeleton, level: "easier" })).toContain(
      'the level is "easier", so lower',
    );
    for (const level of ["standard", undefined] as const) {
      expect(planFactsPrompt.user({ ...withSkeleton, level })).not.toContain("Pitch: the level");
    }
    expect(planFactsPrompt.system).toContain('A "Level" line in the brief moves');
    // Pinned objectives are served as written, and the outline still lists them by position.
    const pinned = planFactsPrompt.user({
      ...withSkeleton,
      givenObjectives: [{ id: "o1", text: "X" }],
    });
    expect(pinned).toContain("Objectives (fixed by the teacher; serve them as written):");
    expect(harder).toContain("\nObjectives:\n");
  });

  test("TEACH-67: parse-brief asks only for what the rules did not find and never for the topic", () => {
    const input = SAMPLE_INPUTS["parse-brief"] as {
      text: string;
      yearGroups: string[];
      subjects: string[];
    };
    const known = parseBriefPrompt.user({ ...input, alreadyKnown: { yearGroup: "Year 8" } });
    expect(known).not.toContain("yearGroup");
    expect(known).toContain('"subject": one of "Science", "Maths", "English", or "Other"');
    expect(known).toContain('"durationMin": whole minutes');
    expect(known).toContain('"level": "easier", "standard" or "harder"');
    expect(known).toContain(`\n"""\n${input.text}\n"""`);
    const blank = parseBriefPrompt.user({ ...input, alreadyKnown: {} });
    expect(blank).toContain('"yearGroup": one of "Year 7", "Year 8", "Year 9"');
    const all = parseBriefPrompt.user({
      ...input,
      alreadyKnown: { yearGroup: "Year 8", subject: "Science", durationMin: 50 },
    });
    expect(all).not.toContain("yearGroup");
    expect(all).not.toContain("subject");
    expect(all).not.toContain("durationMin");
    expect(all).toContain('"level"');
    for (const rule of [
      "When a field is unknown, omit the key.",
      "Never return the topic, a title, a person's name or any key not asked for.",
      "never repeat or contradict them",
    ]) {
      expect(parseBriefPrompt.system).toContain(rule);
    }
    expect(parseBriefPrompt.system).not.toContain("topic:");
    // The fixture is the model's half of a parse whose rules found the year group and minutes.
    expect(FIXTURES.parseBrief).toEqual({ subject: "Science", level: "easier" });
  });

  test("TEACH-67: the fill prompt lists every slot with its types and count, the guides, and the reserved stems", () => {
    const text = generateWorksheetFillPrompt.user(
      SAMPLE_INPUTS["generate-worksheet-fill"] as never,
    );
    expect(text).toContain(
      "Recipe: practise-core (practise). The filled blocks take about 15 minutes.",
    );
    expect(text).toContain("  slot 2: 2–3 blocks; types: question, multiple-choice");
    expect(text).toContain("  slot 4: exactly 1 block; types: fill-gap, matching");
    // Each allowed type once, with its shape and its guide, good and bad.
    for (const type of ["question", "multiple-choice", "fill-gap", "matching"]) {
      expect(text.split(`- ${type}: { "type": "${type}"`)).toHaveLength(2);
    }
    expect(text).not.toContain("- word-bank:");
    expect(text).toContain("  A matching block pairs 3 to 6 items");
    expect(text).toContain("  Good: 'Which of these is a rodent?'");
    expect(text).toContain("  Bad: 'Rodents ___ ___ ___.'");
    expect(text).toContain(
      "Used on the slides and exit ticket — do not use these stems:\n  - In which state of matter are the particles furthest apart?",
    );
    expect(text).toContain("Objective verb: Explain.");
    expect(text).toContain("Question pool for the sheet");
    expect(text).toContain("Answer with the fill JSON.");
    // The carried-over rules and the per-slot ones are in the system prompt.
    for (const rule of [
      "You fill only the numbered slots the brief lists",
      "Use only those types, within that count.",
      "use a pool question's stem, answer and distractors as given",
      "never one from the reserved list",
      'order the questions by tier: "easy", then "core", then "stretch"',
      "every objective is practised by at least one block",
    ]) {
      expect(generateWorksheetFillPrompt.system).toContain(rule);
    }
    // The fixture answers the knowledge-check frame's one slot with the items it allows;
    // `worksheet/fill.test.ts` holds it to the frame's own slot rule.
    expect(FIXTURES.worksheetFill.slots.map((s) => s.index)).toEqual([3]);
    for (const block of FIXTURES.worksheetFill.slots[0]?.blocks ?? []) {
      expect(block.type).toBe("multiple-choice");
    }
    // The shape line wins over a guide's count (the spec wants exactly 4 options, at most 5 pairs).
    expect(generateWorksheetFillPrompt.system).toContain("the shape wins");
  });

  test("every prompt states the house rules", () => {
    // "Answer with the requested JSON only" left the house rules on 23 Sept 2026: `call.ts` repairs
    // the text and validates it against the schema, so no prompt has to ask for JSON.
    for (const prompt of Object.values(PROMPTS)) {
      expect(prompt.system).toContain("British English");
      expect(prompt.system).toContain("Never invent or include the name of any pupil");
      expect(prompt.system).not.toContain("JSON only");
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
    // Ruling 82: the floors are slides after the title and objectives, whole slides for a fixed
    // count (10 → 8 taught; 40% → 3), the percentage when the brief leaves the count open.
    expect(skeleton).toContain(
      "At least 3 of the 8 slides after the title and objectives slides are explain slides.",
    );
    const open = PROMPTS["plan-skeleton"].user({
      ...(SAMPLE_INPUTS["plan-skeleton"] as object),
      slideCount: undefined,
    } as never);
    expect(open).toContain(
      "At least 40% of the slides after the title and objectives slides are explain slides.",
    );
    // No outline minutes anywhere in either Plan call; the skeleton's lesson-length line is the
    // brief's, and `factsBlock` renders none since 23 Sept 2026 (ruling 82).
    for (const text of [skeleton, open, planSkeletonPrompt.system]) {
      expect(text.replace(/Lesson length: \d+ minutes/, "")).not.toMatch(/minute|\bmin\b/);
    }
    expect(outlineOfExample().some((e) => "minutes" in e)).toBe(false);
    expect(skeleton).toContain(
      "Confront the misconception on a true-false slide or as a multiple-choice distractor.",
    );
    expect(skeleton).not.toContain("The teacher also said");
    expect(skeleton).not.toContain("Question tiers");
    // The facts call adds the tier target from the shape's weights (Explain / New: 5 / 5 / 2).
    const facts = PROMPTS["plan-facts"].user(SAMPLE_INPUTS["plan-facts"] as never);
    expect(facts).toContain("This is an Explain lesson for a class new to the topic.");
    expect(facts).toContain("Question tiers: 5 easy, 5 core, 2 stretch (at least 12 in all).");
    expect(facts).toContain("Outline (position: kind, phase — what the slide adds):");
    expect(facts.replace(/Lesson length: \d+ minutes/, "")).not.toMatch(/minute|\bmin\b/);
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
      entry: { kind: "vocabulary", factRefs: ["v1"] },
      vocabularySlots: 4,
    } as never);
    expect(vocab).toContain("at most 4 vocabulary entries");
    expect(vocab).toContain("keep every term another shown definition uses");
  });

  test("UX ruling 81: the shared practise slide asks its questions verbatim and keeps the answers in notes", () => {
    const system = PROMPTS["generate-slide"].system;
    const rule = system.slice(
      system.indexOf("When an `instructions` slide's facts include questions"),
    );
    expect(rule).not.toBe(system);
    const line = rule.slice(0, rule.indexOf("\n"));
    expect(line).toContain('`heading` "Your turn"');
    expect(line).toContain("stems verbatim, in the order this slide's facts name them");
    expect(line).toContain("with no number (the layout numbers them)");
    expect(line).toContain('`notes` gives each answer on its own line ("1. <answer>")');
    expect(line).toContain("the misconception to watch for");
    expect(line).toContain("mini-whiteboards or books");
    // Minimalism rubric (v20): the reserved stems are listed once, in the user turn, with the one
    // instruction not to use them; the system prompt no longer repeats "never a reserved stem".
    expect(system).not.toContain("reserved stem");
    const user = PROMPTS["generate-slide"].user({
      ...(SAMPLE_INPUTS["generate-slide"] as object),
      entry: { kind: "instructions", factRefs: ["q4"] },
    } as never);
    expect(user).toContain("do not use these stems");
  });

  test("quality PRD G3: the slide line assigns the callout; the shape shows it once, conditionally", () => {
    const system = PROMPTS["generate-slide"].system;
    expect(system).toContain("`callout`, where shown, only when the slide line assigns one");
    expect(system).toContain('"callout"?: { "kind", "text" }');
    expect(system).toContain("callout text ≤ 120");
    // Only the three teaching kinds carry the box.
    const shapeLines = system.split("\n").filter((l) => l.includes('"callout"?'));
    expect(shapeLines.map((l) => l.slice(2, l.indexOf(":")))).toEqual([
      "content",
      "image-text",
      "worked-example",
    ]);
    const base = SAMPLE_INPUTS["generate-slide"] as object;
    const withBox = PROMPTS["generate-slide"].user({
      ...base,
      entry: {
        kind: "content",
        factRefs: ["k1"],
        callout: { kind: "watch-out", factRefs: ["m1"] },
      },
    } as never);
    expect(withBox).toContain(
      'This slide carries a "watch-out" callout: set `callout` to kind "watch-out" with `text` one line for pupils, from m1 only.',
    );
    const without = PROMPTS["generate-slide"].user({
      ...base,
      entry: { kind: "content", factRefs: ["k1"] },
    } as never);
    expect(without).not.toContain("callout");
  });

  test("lab r3: a teaching slide is shown the questions that later test it, and told to teach what their answers need", () => {
    const base = SAMPLE_INPUTS["generate-slide"] as object;
    const withLater = PROMPTS["generate-slide"].user({
      ...base,
      laterQuestions: [
        { stem: "Which state has particles furthest apart?", answer: "Gas" },
        { stem: "Explain why a gas fills its container.", answer: "Its particles move freely." },
      ],
    } as never);
    expect(withLater).toContain(
      "Asked of pupils later in the lesson, on later slides (shown for reference):\n  - Which state has particles furthest apart? — answer: Gas\n  - Explain why a gas fills its container. — answer: Its particles move freely.\nTeach here, within this slide's limits, what each answer rests on — the name, quotation, reason, example or step a pupil needs — without naming these questions.",
    );
    // The block sits before the closing line, once.
    expect(withLater.indexOf("Asked of pupils later")).toBeLessThan(
      withLater.indexOf("Answer with the JSON"),
    );
    expect(withLater.split("Asked of pupils later")).toHaveLength(2);
    // Absent or empty (production, and lab slides nothing later tests): the block is not rendered.
    const without = PROMPTS["generate-slide"].user(base as never);
    const empty = PROMPTS["generate-slide"].user({ ...base, laterQuestions: [] } as never);
    expect(without).not.toContain("later in the lesson");
    expect(empty).toBe(without);
  });

  test("audit B4: reserved stems reach only the kinds that compose one; vocabulary is defined where used", () => {
    const base = SAMPLE_INPUTS["generate-slide"] as { referenced: object };
    const render = (kind: string) =>
      PROMPTS["generate-slide"].user({ ...base, entry: { kind, factRefs: ["v1", "k1"] } } as never);
    expect(render("sort")).toContain("Reserved for other slides");
    for (const kind of ["content", "worked-example", "multiple-choice", "vocabulary"]) {
      expect(render(kind)).not.toContain("Reserved for other slides");
    }
    const define = "Define each vocabulary term in a few words where the slide first uses it";
    expect(render("content")).toContain(define);
    expect(render("vocabulary")).not.toContain(define);
    const noVocabulary = PROMPTS["generate-slide"].user({
      ...base,
      referenced: { ...base.referenced, vocabulary: [] },
      entry: { kind: "content", factRefs: ["k1"] },
    } as never);
    expect(noVocabulary).not.toContain(define);
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
    // Ruling 82: the slide line has no minutes, whether or not the entry still carries them.
    expect(text).toContain('Slide 4 of 10: kind "vocabulary", explain phase, covering facts');
  });

  test("TEACH-230 row 1: an Apply content slide is told the Apply paragraph and not the Explain one", () => {
    const apply = lessonShapeOf({
      objectiveVerb: "Apply column addition",
      priorConfidence: "Some prior knowledge",
    });
    const text = PROMPTS["generate-slide"].user({
      ...(SAMPLE_INPUTS["generate-slide"] as object),
      entry: { kind: "content", factRefs: ["k1"] },
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
    // TEACH-262 row 2: the reviewer is told the scope and what is exempt.
    expect(PROMPTS.evaluate.system).toContain(
      "`verb-fit` is for the slides that teach the mechanism, method or judgement and for the core and stretch tasks.",
    );
    for (const exempt of [
      "the title, objectives, starter and vocabulary slides",
      "the first content slide when the class is new to the topic or the lesson is Recall",
      "a true-false or multiple-choice that confronts a misconception",
      "the easy tier of the worksheet",
      "the number of items on an exit-ticket",
    ]) {
      expect(PROMPTS.evaluate.system).toContain(exempt);
    }
    // TEACH-262 row 3: exit-ticket sentences read per item; the recipe fixes the item count.
    expect(VERB_WRITING.Explain).toContain("Each `exit-ticket` item asks pupils to explain");
    expect(VERB_WRITING.Explain).not.toContain("explain one thing");
    expect(VERB_WRITING.Evaluate).toContain("Each `exit-ticket` item");
    expect(VERB_WRITING.Evaluate).not.toContain("one judgement");
    expect(VERB_WRITING.Recall).toContain("three things");
    expect(VERB_WRITING.Apply).toContain("three short problems");
    expect(PROMPTS.repair.system).toContain("A verb-fit problem is fixed by changing the task");
  });

  test("lab r1: Repair shows the read-only slides after the target and lists errors before warnings", () => {
    const text = PROMPTS.repair.user(SAMPLE_INPUTS.repair as never);
    const target = text.indexOf('Slide s7 (kind "multiple-choice") currently says:');
    const others = text.indexOf("Other slides in the lesson, for reference only");
    const problems = text.indexOf("Problems reported:");
    expect(target).toBeGreaterThan(-1);
    expect(others).toBeGreaterThan(target);
    expect(problems).toBeGreaterThan(others);
    expect(text).toContain("Slide 5 (content, taught earlier):\nSolids keep their shape.");
    expect(text).toContain("Slide 6 (worked-example, before the target):\nIs ice a solid?");
    expect(text.indexOf("- [answer-correctness, error] Wrong.")).toBeLessThan(
      text.indexOf("- [verb-fit, warning] Asks pupils to name, not explain."),
    );
    // Audit B6: the plan (C2) and the current factRefs (C3) render only when given; the photo rule
    // travels with the photograph, not in the system text.
    expect(text).not.toContain("Planned to teach");
    expect(PROMPTS.repair.system).not.toContain(
      "An `image-text` slide is written to its photograph",
    );
    const planned = PROMPTS.repair.user({
      ...(SAMPLE_INPUTS.repair as RepairInput),
      planned: { factRefs: ["k6", "q3"], brief: "Shows how a groyne traps sand." },
      currentFactRefs: ["k6"],
    });
    expect(planned).toContain(
      "Which state?\nfactRefs: k6\n\nPlanned to teach k6, q3: Shows how a groyne traps sand.\nKeep every fact the slide was planned to teach; fix a warning without dropping one.",
    );
    const photographed = PROMPTS.repair.user({
      ...(SAMPLE_INPUTS.repair as RepairInput),
      target: {
        kind: "slide",
        slideKind: "image-text",
        slideId: "s4",
        text: "Look",
        photo: "none",
      },
    });
    expect(photographed).toContain("An `image-text` slide is written to its photograph");
    // A block repair has no context and renders no header for it.
    const { context: _context, ...withoutContext } = SAMPLE_INPUTS.repair as never as RepairInput;
    expect(PROMPTS.repair.user(withoutContext)).not.toContain("Other slides in the lesson");
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

describe("generate-slide v25: a teaching slide names its misconception", () => {
  const input = SAMPLE_INPUTS["generate-slide"] as Parameters<typeof generateSlidePrompt.user>[0];
  const keyIdea = input.referenced.keyIdeas?.[0];
  const misconception = input.referenced.misconceptions.find((m) =>
    (m.objectiveRefs ?? []).some((o) => keyIdea?.objectiveRefs?.includes(o)),
  );

  test("a content slide without its own watch-out gets the line, by id", () => {
    expect(keyIdea && misconception).toBeTruthy();
    const content = {
      ...input,
      entry: { ...input.entry, kind: "content", factRefs: [keyIdea?.id ?? ""] },
    } as typeof input;
    expect(ownMisconceptions(content)).toContain(misconception?.id ?? "");
    expect(generateSlidePrompt.user(content)).toContain(
      `(${misconception?.id}): end the body with one sentence on what some pupils think and why it is wrong.`,
    );
  });

  test("a watch-out on the slide, or a non-teaching kind, gets none", () => {
    const base = { ...input.entry, factRefs: [keyIdea?.id ?? ""] };
    const withCallout = {
      ...input,
      entry: {
        ...base,
        kind: "content",
        callout: { kind: "watch-out", factRefs: [misconception?.id ?? ""] },
      },
    } as typeof input;
    expect(ownMisconceptions(withCallout)).toEqual([]);
    const question = { ...input, entry: { ...base, kind: "multiple-choice" } } as typeof input;
    expect(ownMisconceptions(question)).toEqual([]);
    expect(generateSlidePrompt.user(question)).not.toContain("Its misconception");
  });
});

/* verify-facts v6 (l6c): the user turn lists the starter's retrieval set as `r1`–`rN` lines (code on
 * lab/l6c-code); the field map says which fields a starter line has. */
describe("verify-facts v6: the field map names a starter line's fields", () => {
  test("a starter question is `question — answer`, corrected as stem or answer", () => {
    expect(verifyFactsPrompt.system).toContain(
      "a starter question `question — answer` (fields stem, answer); every other field is labelled.",
    );
  });
});
