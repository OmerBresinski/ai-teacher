import { z } from "zod";
import type { LessonShape } from "../shapes";
import { shapeBlock } from "./shape";
import { type Audience, audienceBlock, HOUSE_RULES } from "./shared";

/*
 * Plan, objectives call (ADR 0025 §17): the lesson's objectives on their own, before the outline
 * (`plan-skeleton`) or the facts (`plan-facts`) are asked for, so the objectives a teacher reads
 * first are written against the curriculum rather than fitted to a skeleton. One short call,
 * provider-neutral: it runs on whichever gateway model is cheapest, so the system text is kept
 * small, the shape sketch is one line, and every rule is stated rather than shown.
 *
 * The curriculum extract is a whole Oak unit — several lessons' outcomes, learning points,
 * keywords and misconceptions — plus the programme-of-study bullet it serves. It is deliberately
 * NOT introduced with `plan-skeleton`'s `SOURCE_INSTRUCTION`: that sentence is for a teacher's own
 * upload, and "treat the material's own sequence as the default lesson order" made planners copy
 * the unit's first lesson into an hour meant to span the unit. `CURRICULUM_INSTRUCTION` says the
 * opposite about order and asks for an anchor instead.
 *
 * v2 (17 Sept 2026, after a 326-call hand-graded bench of v1 over Year 3–13):
 *  - v1's "match the depth of the lesson's objective verb" was read as a rule about every line and
 *    produced three clones at one verb. The brief's verb is now the level the lesson REACHES; the
 *    ladder rule states exactly what `objectives-check.ts` enforces — the last objective at the
 *    reach, none above it, none more than `LADDER_DEPTH` levels below it — and leaves the order of
 *    the others free, so Explain, Apply, Evaluate and Apply, Explain, Evaluate both pass.
 *  - v1's count clause ("4 only at 75 minutes or more, or when the class is revisiting") was missed
 *    by every model but one — 10 breaches in 64 sets. The revisiting branch is dropped.
 *  - Models invented `curriculumAnchor` when no extract was given. The prose telling them not to is
 *    kept, but `planObjectivesOutputSchemaFor(false)` now removes the field: a slot in the output
 *    template outranks any prose rule about leaving it empty (CORE, 2026-08-04).
 *  - Objectives ran past what the class had met. `priorKnowledge` is a new optional input with one
 *    rule naming the line it renders, so the input is not inert (CORE: supply the fact AND point
 *    at it).
 *
 * v3 (17 Sept 2026, after a 104-call hand-graded bench of v2):
 *  - v2's ladder sentence read as "a ladder is expected": on Explain lessons with three objectives
 *    Luna and Gemini spent the first slot on a filler recall line ("State that rocks occur
 *    naturally") and lost a third of the topic (Luna 9.9 -> 8.9 on five Year 3-6 Explain briefs).
 *    The ladder is now permitted, not the default: every objective sits at the reach unless a lower
 *    step is genuinely needed first, and no objective may be a fact outside the topic's substance.
 *    v2's "not the level of every line" is folded in — it contradicted the new default.
 *  - The no-source objective is no longer strict, so an invented anchor is stripped, not retried.
 *
 * Bump `version` whenever `system` or `user` changes wording (`shape.ts` and `shared.ts` included).
 */

export type PlanObjectivesInput = {
  topic: string;
  durationMin: number;
  /** The lesson's shape, from the brief's answers and the class (`lessonShapeOf`). */
  shape: LessonShape;
  audience: Audience;
  /**
   * The brief's class-context prior-knowledge line, when the teacher gave one ("read Act 1 scenes
   * 1 to 5"). Where it bounds the material, the objectives stay inside it. Optional.
   */
  priorKnowledge?: string | undefined;
  /**
   * A curriculum extract retrieved for this brief: the programme-of-study bullet and a whole unit
   * (several lessons' outcomes, key learning points, keywords, misconceptions). Optional.
   */
  curriculum?: { text: string } | undefined;
};

/** What the model is told when a curriculum unit is retrieved. Never `SOURCE_INSTRUCTION`. */
export const CURRICULUM_INSTRUCTION =
  "Curriculum extract for this brief — a unit of several lessons and the bullet it serves, not a lesson to copy and not an order to follow. Use it to place this lesson against the whole unit and to anchor each objective.";

/** How the prior-knowledge line is introduced, and the phrase the system rule names. */
export const PRIOR_KNOWLEDGE_LABEL = "What the class has already covered";

const objectiveText = z.string().min(8).max(120);
const curriculumAnchor = z.string().max(160);

/** With a curriculum extract: every objective must carry its anchor. */
const AnchoredOutputSchema = z.strictObject({
  objectives: z
    .array(z.strictObject({ text: objectiveText, curriculumAnchor }))
    .min(2)
    .max(4),
});

/**
 * With no extract: the anchor field does not exist, so it cannot be asked for. The objective is a
 * plain `z.object`, not `strictObject`: a model that emits `curriculumAnchor` anyway (measured on
 * Luna, 2 of 3 calls) has the stray key stripped instead of failing the whole answer into a ~5s
 * retry. The outer object stays strict, so an invented top-level field is still a parse error.
 */
const UnanchoredOutputSchema = z.strictObject({
  objectives: z
    .array(z.object({ text: objectiveText }))
    .min(2)
    .max(4),
});

export type PlanObjectivesSchema = typeof AnchoredOutputSchema | typeof UnanchoredOutputSchema;

/**
 * The schema for one call. The anchor is a question only where an extract was given: a field that
 * exists gets filled, whatever the prose says, so the no-source case removes it rather than asking
 * for it back.
 */
export function planObjectivesOutputSchemaFor(hasCurriculum: boolean): PlanObjectivesSchema {
  return hasCurriculum ? AnchoredOutputSchema : UnanchoredOutputSchema;
}

/**
 * What the objectives call may return (ADR 0025 §8: content only, no ids). The permissive form,
 * accepting an anchor or none: kept for callers and the bench that parse a set without knowing
 * whether an extract was retrieved. A live call should use `planObjectivesOutputSchemaFor`.
 */
export const PlanObjectivesOutputSchema = z.strictObject({
  objectives: z
    .array(z.strictObject({ text: objectiveText, curriculumAnchor: curriculumAnchor.optional() }))
    .min(2)
    .max(4),
});
export type PlanObjectivesOutput = z.output<typeof PlanObjectivesOutputSchema>;

/**
 * The house rules, less the `factRefs` line: this call is given no fact ids and its schema has no
 * `factRefs`, so the sentence is an instruction about a field that does not exist here. British
 * English, the no-names rule, the pitch line and the JSON-only line are all kept.
 */
const OBJECTIVE_HOUSE_RULES = HOUSE_RULES.split("\n")
  .filter((rule) => !rule.startsWith("Every fact id"))
  .join("\n");

/** The shape sketch: one line, so no model spends its budget copying a worked example. */
const SHAPE_SKETCH =
  '{ "objectives": [{ "text": "Explain why the Romans invaded Britain", "curriculumAnchor": "the Roman Empire and its impact on Britain" }] }';

export const planObjectivesPrompt = {
  version: "plan-objectives.v3",
  system: [
    "You are an experienced UK teacher writing the learning objectives for one lesson.",
    "",
    "Rules:",
    OBJECTIVE_HOUSE_RULES,
    'Each objective is one idea, at most 16 words, starting with one observable verb: what a pupil can do by the end, in words the class can read — for a primary class, words a Year 4 child could read. Never open with "understand", "know", "learn", "appreciate" or "be aware of"; never join two ideas with "and"; never name an activity or a slide.',
    "Levels rise: Recall (names or states), Explain (how or why), Apply (uses a method), Evaluate (judges, with a reason). The lesson's verb is its reach: every objective sits at that verb unless a lower level is genuinely needed (a method before judging, a definition the class lacks), and never a fact outside the topic's substance; the last sits at that verb, none above, none over two levels below. Where the class is new to the topic and the reach is Apply or Evaluate, start one level below the reach.",
    "Give 2 objectives under 45 minutes and 3 otherwise; a 4th only at 75 minutes or more.",
    `Where the brief gives "${PRIOR_KNOWLEDGE_LABEL}", keep every objective inside that material and still reach the lesson's verb.`,
    "A curriculum extract, when given, is a whole unit with the bullet it serves, not this lesson's plan, and its order is not this lesson's order: never take one lesson's outcomes as this lesson's objectives. Read all of it, then answer the brief's topic; where the topic is an overview, span the unit's arc — for a historical episode its cause, the event, what changed, and who resisted — not its opening lesson. Anchor each objective in the learning point or bullet it serves: quote or paraphrase it in \"curriculumAnchor\", at most 160 characters.",
    'With no extract, write from the national curriculum for this subject, key stage and topic as you know it, and leave "curriculumAnchor" out.',
    "",
    "Answer with JSON only, in this shape:",
    SHAPE_SKETCH,
  ].join("\n"),
  user(input: PlanObjectivesInput): string {
    const [shapeLine] = shapeBlock(input.shape);
    const parts = [
      `Topic or objective: ${input.topic}`,
      `Lesson length: ${input.durationMin} minutes`,
      audienceBlock(input.audience),
    ];
    if (input.priorKnowledge) {
      parts.push(`${PRIOR_KNOWLEDGE_LABEL}: ${input.priorKnowledge}`);
    }
    parts.push(`Lesson shape: ${shapeLine}`);
    if (input.curriculum) parts.push("", CURRICULUM_INSTRUCTION, input.curriculum.text);
    parts.push("", "Answer with the objectives JSON.");
    return parts.join("\n");
  },
} as const;
