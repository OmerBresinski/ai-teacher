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
 * v4 (22 Sept 2026, UX rulings 81 and 82):
 *  - The count follows the deck's slide count, not the lesson's length (ruling 82 removes length as
 *    a size control): 2 objectives at 6 slides, 3 at 8 or 10, 3 or a genuinely needed 4th at 12.
 *    The digits live in ONE place, the user turn's "Number of objectives" line (`objectiveCountLine`,
 *    from `objectiveCountFor` in `objectives-check.ts`, the same table the check enforces). The
 *    system text names the line and never a number: a static count beside a computed one is a
 *    second source of truth and the more quotable (CORE, 2026-09-16).
 *  - `durationMin` is gone from the input and the user turn: nothing in this call reads it now,
 *    and a "Lesson length" line left in would invite the model to size the set by minutes again.
 *  - The 12-slide 4th is conditional in the line itself ("3, or 4 only if the topic has a fourth
 *    distinct part"): the target comes first and the extra carries its test, so "up to 4" is not
 *    read as a target. The ladder rule's "never a fact outside the topic's substance" already bars
 *    a filler fourth; restating it here would cost the word budget for no new rule.
 *
 * v5 (23 Sept 2026, UX ruling 81 amended): the count is a CEILING set by the slide count, not a
 * target. Each objective needs a teaching slide and a practice slide and the exit ticket checks them
 * all, so the table is floor((slides - 3) / 2): 1 at 6, 2 at 8, 3 at 10, 4 at 12, with no minimum
 * beyond 1.
 *  - The user line says "at most N" and, in the same line, that fewer is right for a narrow topic
 *    and that one part is never split to reach N: the two ways a model fills a ceiling it reads as
 *    a target are padding (a filler recall line, the v2/v3 failure) and over-splitting one idea.
 *    At 6 slides the line is "exactly 1" and asks for the outcome the lesson reaches as one idea,
 *    so the model does not cram two objectives into one with "and".
 *  - The system rule calls the line a ceiling and bars padding, still with no digits (CORE,
 *    2026-09-16); the anti-split clause lives only in the user line, beside the number it guards,
 *    to keep the system text under its word budget.
 *  - The ladder's "start one level below the reach" for a new class assumed room for a step below;
 *    with one objective it would put the only objective under the reach, so it now ends "unless
 *    there is only one objective", matching the check (one objective at the reach passes).
 *  - The output schemas accept 1 to 4 objectives (were 2 to 4).
 *
 * v6 (23 Sept 2026, UX ruling 81 rewritten; reverses v4 and v5): the objectives come from the
 * TOPIC, and the slide count does not set their number. How many objectives a lesson has is a
 * teaching decision; a longer deck teaches the same objectives in more depth, not more of them.
 *  - `slideCount`, the user turn's "Number of objectives" line and `objectiveCountFor` are gone.
 *    Lesson length stays out too (ruling 82).
 *  - With no per-call number there is no second source of truth to guard against, so the count rule
 *    now states its numbers plainly in the system text: usually two or three that build on each
 *    other, one for one tight skill, four only for four distinct parts (ruling 64's 1 to 4).
 *    Padding and splitting one idea stay barred in the same sentence: they are how a model fills
 *    a number it reads as a target.
 *  - Objectives in a lesson build on each other and share its key ideas, so the rule says so; the
 *    ladder keeps "unless there is only one objective" from v5, and the schemas keep 1 to 4.
 *  - The ladder's "never a fact outside the topic's substance" is folded into the count rule's
 *    "never add a filler line", which says the same thing where the count is decided.
 *
 * v7 (23 Sept 2026, minimalism rubric; 409 -> 299 system words, no behaviour change intended):
 *  - Gone because code or schema enforces it: "at most 16 words" (`objectives-check` blocks it and
 *    the schema caps 120 characters), the banned-verb list (the check blocks those words
 *    literally; the positive "one observable verb" stays), "at most 160 characters" and "leave
 *    curriculumAnchor out" (the schema sizes the anchor and removes the field with no extract).
 *  - Gone because it restates the user turn: the extract rule's "a whole unit, not this lesson's
 *    plan… read all of it" is `CURRICULUM_INSTRUCTION`, sent beside the extract. What stays is the
 *    one clause the instruction lacks, traceable to round 1 (Terra, DeepSeek, Qwen copying Oak's
 *    lesson 1): span the unit's arc, not its opening lesson. The history-only list of what an
 *    arc contains was a strategy essay.
 *  - Gone as untraceable to a bench failure: "never name an activity or a slide", "(for primary,
 *    words a Year 4 child could read)" (the house pitch rule covers it), "with no extract, write
 *    from the national curriculum as you know it".
 *  - The ladder stays whole: since 23 Sept the check only measures levels (lab metrics), so the
 *    prompt is the only thing holding the ladder, and rounds 5 and 6 measured every clause of it.
 *
 * v8 (23 Sept 2026, same day): v7's first live round (objectives-c-v7/v7b, Luna, 6 sets) ran 2 of
 * 6 sets to 18 and 19 words, against 0 of 6 on these briefs under v3 and 1 of 26 overall, so "at
 * most 16 words" is back on that bench number alone (rubric 6). v7's ground for deleting it was
 * wrong: `objectives-check` is imported by `eval/objectives-bench.ts` and `src/lab/plan-pipeline.ts`
 * only, not by `stages/plan.ts`, so nothing on the live path holds the limit but this line. No
 * banned opener appeared, so that list stays out.
 *
 * v9 (23 Sept 2026, after the rubric judge): "in words the class can read" is gone from the first
 * rule; the shared pitch house rule two lines above already says it, the ground v7 used to drop the
 * Year 4 parenthetical (rubric 5). 303 -> 297 system words.
 *
 * v10 (23 Sept 2026, second rubric judge): "building on each other and sharing its key ideas" is
 * gone from the count rule. It came in with the ruling-81 rewrite (v6), and no bench row names an
 * output it fixed (rubric 3); the ladder and the anti-padding clause carry the count. 297 -> 276, with the
 * shared house rules' "JSON only" line gone the same day (`shared.ts`).
 *
 * v11 (23 Sept 2026, third rubric judge): the user turn's closing "Answer with the objectives
 * JSON." is gone. The system text already ends "JSON, in this shape:" plus the sketch, so it was
 * the output shape a second time (rubric 2), and the format itself is `call.ts`'s to enforce
 * (`Output.object`, `repairJsonText`, schema validation), the same ground v10 used to drop the house
 * rules' "JSON only" line (rubric 5). The user turn now ends on its last input.
 *
 * Bump `version` whenever `system` or `user` changes wording (`shape.ts` and `shared.ts` included).
 */

export type PlanObjectivesInput = {
  topic: string;
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
    .min(1)
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
    .min(1)
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
    .min(1)
    .max(4),
});
export type PlanObjectivesOutput = z.output<typeof PlanObjectivesOutputSchema>;

/**
 * The house rules, less the `factRefs` line: this call is given no fact ids and its schema has no
 * `factRefs`, so the sentence is an instruction about a field that does not exist here. British
 * English, the no-names rule and the pitch line are all kept.
 */
const OBJECTIVE_HOUSE_RULES = HOUSE_RULES.split("\n")
  .filter((rule) => !rule.startsWith("Every fact id"))
  .join("\n");

/** The shape sketch: one line, so no model spends its budget copying a worked example. */
const SHAPE_SKETCH =
  '{ "objectives": [{ "text": "Explain why the Romans invaded Britain", "curriculumAnchor": "the Roman Empire and its impact on Britain" }] }';

export const planObjectivesPrompt = {
  version: "plan-objectives.v11",
  system: [
    "You are an experienced UK teacher writing the learning objectives for one lesson.",
    "",
    "Rules:",
    OBJECTIVE_HOUSE_RULES,
    "Each objective is one idea, at most 16 words, starting with one observable verb: what a pupil can do by the end.",
    "Levels rise: Recall (names or states), Explain (how or why), Apply (uses a method), Evaluate (judges, with a reason). The lesson's verb is its reach: every objective sits at that verb unless a lower level is genuinely needed (a method before judging, a definition the class lacks); the last sits at that verb, none above, none over two levels below. Where the class is new to the topic and the reach is Apply or Evaluate, start one level below the reach unless there is only one objective.",
    "Give as many objectives as the topic has: usually two or three; one for one tight skill; four only for four distinct parts. Never split one idea or add a filler line to make another.",
    `Where the brief gives "${PRIOR_KNOWLEDGE_LABEL}", keep every objective inside that material and still reach the lesson's verb.`,
    'Where the topic spans the curriculum extract\'s unit, the objectives span its arc, not its opening lesson. Put the learning point or bullet each objective serves in "curriculumAnchor".',
    "",
    "JSON, in this shape:",
    SHAPE_SKETCH,
  ].join("\n"),
  user(input: PlanObjectivesInput): string {
    const [shapeLine] = shapeBlock(input.shape);
    const parts = [`Topic or objective: ${input.topic}`, audienceBlock(input.audience)];
    if (input.priorKnowledge) {
      parts.push(`${PRIOR_KNOWLEDGE_LABEL}: ${input.priorKnowledge}`);
    }
    parts.push(`Lesson shape: ${shapeLine}`);
    if (input.curriculum) parts.push("", CURRICULUM_INSTRUCTION, input.curriculum.text);
    return parts.join("\n");
  },
} as const;
