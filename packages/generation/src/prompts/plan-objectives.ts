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
 * v12 (24 Sept 2026, round 1 blind judges): the call also returns three retrieval questions, with
 * answers, for the lesson's starter (`retrieval`, optional in the schema, always asked for in the
 * prose). Round 1 left the starter to the outline, which filled it with the lesson's own easiest
 * questions; the B judge marked those tested-not-taught in 8 of 12 lab decks (Y4 Romans "Which
 * emperor ordered the invasion in AD 43?" before slide 4 teaches Claudius; Y7 ratio "Share £42 in
 * 2:5" before sharing is taught; Y6 evacuation "When did evacuation begin?" before slide 4) and
 * marked two more starters down as prediction discussion, not retrieval. This call is the one that
 * knows the objectives before any slide exists, so it names what comes BEFORE them.
 *  - One rule, three clauses, each on a judged failure: the source (earlier lessons this lesson
 *    builds on: the tested-not-taught starters), the test the judge applies (answerable before
 *    this lesson begins), the form (one line or a choice: the discussion starters).
 *  - The count is in the prose, once, and the schema pins it at three: on the gateway's
 *    non-strict route only prose counts reach the model (openai.md 2026-09-23), and Luna writes to
 *    the number it is given.
 *  - The prior-knowledge rule gains "and draw the retrieval questions from it", so the label is
 *    still named once (Luna guide 12) and the teacher's own line feeds the starter first.
 *  - The slot is in the sketch, so it is filled although the schema leaves it optional (CORE
 *    2026-09-23): recorded fixtures, `fromFacts` reruns and the bench parse without it.
 *  - 276 -> 346 system words (role +5, the rule 40, the prior-knowledge clause 6, the sketch's one
 *    retrieval item 19); the test's alarm moves to 360 with the growth accounted for above.
 *
 * v13 (24 Sept 2026, rounds r3/r4 recorded runs, `eval/results/lab/*` "starter retrieval"): in 4 of
 * 13 v12 runs the three questions asked this lesson's own content, the objectives the same answer
 * had just written, so the starter pre-tested the lesson and the blind judges marked it
 * tested-not-taught again (Y9 coasts: "waves compressing air in cracks" and "hard and soft
 * engineering" are objectives 1 and 3 restated; Y4 Romans: Claudius, slide 4; Y11 rates: powder
 * versus lump, the surface-area objective; Y10 Tempest: whom Prospero controls, the topic). v12
 * bounded the source by time only ("earlier lessons that this lesson builds on ... answerable
 * before this lesson begins"), and every brief's shape line says the class has "some prior
 * knowledge of the topic", so the topic itself read as fair game. The bound is now the one thing
 * the call can check against: the objectives, which precede `retrieval` in the answer. The rule
 * asks for what "the objectives build on and none of them covers"; the time clause is gone, since
 * "learned in an earlier lesson" says it once and it did not hold on its own. 346 -> 343 words.
 *
 * v14 (24 Sept 2026, latency-lab blind judges: 36 gpt-5.6-luna sets on 12 brief-only topics, plus
 * the curriculum-input round; `scratchpad/quality-prd/lab/latency/PROMPT-objectives.md`). The call
 * gets the brief alone, so every rule now reads off the brief and the objectives it writes.
 *  - Retrieval (faulted in ~33 of 36 sets: "3 + 4" for Year 7, "who wrote The Tempest" for Year
 *    10, density before rates, the lesson's own content): v13 asked for what the class "learned in
 *    an earlier lesson", which the call cannot know, and the sketch's own item was trivia with its
 *    answer in the question. The rule now derives each question from an objective (a term, fact or
 *    method it needs that no objective teaches), asks for a check a pupil in this year group could
 *    fail, and asks for three different ones (duplicates were faulted). A first smoke with "taught
 *    before this topic" in place of "no objective teaches" still let a ratio starter ask equivalent
 *    ratios, objective 2, and kept a Year 10 starter off the play the class has read. The sketch item is the
 *    prerequisite of the sample objective.
 *  - Objectives (overlap or split ~13, missing core ~10, vague ~7): the count rule counts the
 *    topic's distinct parts, which together cover its core at the year's level with no two sharing
 *    an idea; the objective rule asks for the concept, process or method by name, not a heading.
 *    "Never split one idea or add a filler line" is folded into that sentence ("no filler line").
 *  - The prior-knowledge and curriculum rules leave the system text for the user turn, beside the
 *    input they govern (`PRIOR_KNOWLEDGE_USE`, `CURRICULUM_USE`), so a brief without them is not
 *    steered by them and the no-extract sketch no longer shows `curriculumAnchor` (judges faulted
 *    identical invented anchors). The prior-knowledge rule is rewritten: fed earlier units, v13's
 *    "keep every objective inside that material" pulled lessons backward (2.44 against 3.61); it
 *    now feeds the starter, the objectives still teach the topic, and only a text read so far
 *    bounds them (the teacher's use). `CURRICULUM_INSTRUCTION` is shared with the teach call and
 *    unchanged. 343 -> 314 system words.
 *
 * v15 (a `from` working field naming the earlier topic before each question) lost to v14 on the
 * blind judges and was slower (median 4.5 -> 7.3 s); v16 starts again from v14's text.
 *
 * v16 (24 Sept 2026, yes/no checklist judge on v14's Luna sets, `latency/RESULTS.md`):
 *  - Starter asks what the lesson teaches (7 of 72 items, unmoved from v13): "What is a groyne?"
 *    beside "hard and soft engineering methods", "How many total parts are in the ratio 4:3?"
 *    beside sharing in a ratio, "Who was Boudicca?" beside why Britons resisted, "What is
 *    infiltration?" beside rainfall moving through a drainage basin. "That no objective teaches"
 *    was read against the objectives' wording, and none of them names its examples or steps. It
 *    is now its own sentence about the lesson: none asks what the lesson teaches, examples
 *    included. Folded into the long sentence ("and that the lesson does not teach") it still
 *    produced the groyne in 2 of 2 coasts sets.
 *  - Vague objectives (9 of 24 Luna sets): "physical and human factors", "flood-management
 *    strategies", "erosion processes", "different forms of power". v14's "not a heading" was met
 *    by a category word, so the rule asks for the actual concepts or methods and, where an
 *    objective covers several factors, methods or strategies, their names. A contrast example
 *    ("diffusion and osmosis, not transport processes") did no better on smokes and was dropped.
 *  - Cut to stay under v14's length: "Rules:" and "what a pupil can do by the end" (the verb is
 *    already observable). 314 -> 309 system words.
 *
 * v17 (25 Sept 2026, gpt-6-luna luna-direct bench, `lab/luna-direct/LUNA6-PROMPTING.md` §2-§4):
 *  - Too few objectives. gpt-6-luna read v14's hedged "usually two or three; one for one tight
 *    skill" as licence for one: Y2 "what plants need" gave a single objective in 3 of 6 runs, the
 *    topic restated ("explain what plants need to grow and stay healthy"); median 2 objectives a
 *    deck against 3 on gpt-5.6-luna, and every later call fans out from that count (fewer claims,
 *    restated slides, thin exits: DIAGNOSIS FM3, FM6, section 2). The count is now unhedged, the
 *    one-objective case has a test the brief can be checked against (a single method or skill),
 *    and a topic about several needs, factors, causes or methods counts as several parts ("or for each close pair" keeps a five-item list
 *    inside four). v16's "name them" made one lumped objective look compliant (6-low p3; "two
 *    ideas in one objective" 1 -> 4 on the v16 checklist), so the list rule says parts, not names.
 *  - "No objective restates the topic" is its own sentence: at effort `low` Luna drops a trailing
 *    exclusion inside a long sentence (v16 note above).
 *
 * v18 (25 Sept 2026, luna-direct yes/no deck checklist): 3 of gpt-6-luna low's 9 question faults
 *    were starter items, two keyed wrong and one with a second right option ("The Home Front"
 *    among the options). Each retrieval question now has one right answer (+6 words; one
 *    sentence covers the open and the picking form). The knowledge errors themselves need verify to see the starter
 *    (CHANGES.md change 4: code, not a prompt rule).
 *
 * v19 (26 Sept 2026, E48; `quality-prd/lab/DIAG-ratio-checks.md` gap 1): "Name the actual methods"
 *    was read as naming the action, not its goal. Under an Explain reach, Y7 "simplifying and
 *    sharing in a ratio" came back as "Explain how dividing every part … keeps it equivalent" (E46
 *    G and 5 of 15 lab decks), which names no end state, so no later call taught simplest form.
 *    The naming rule now asks for each method with the finished result it produces (+10 words, 353;
 *    the test alarm moves once). The
 *    example is from another topic on purpose, so it is not copied into the benched brief.
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

/**
 * What this call does with the prior-knowledge line (v14): sent beside the line, only when there
 * is one, so no brief without it is steered by it. It feeds the starter; it never replaces the
 * topic (v13's "keep every objective inside that material" pulled lessons back into the earlier
 * units it listed); and a text read so far still bounds the objectives, the teacher's use.
 */
export const PRIOR_KNOWLEDGE_USE =
  "That is what the class knows before this lesson: draw the retrieval questions from it. The objectives still teach this lesson's topic, and where it names how far the class has read in a text, they use nothing beyond that point.";

/** What this call does with a retrieved unit (v14): sent after the extract, only when there is one. */
export const CURRICULUM_USE =
  'Where the topic spans this unit, the objectives span its arc, not its opening lesson. Put the learning point or bullet each objective serves in "curriculumAnchor".';

const objectiveText = z.string().min(8).max(120);
const curriculumAnchor = z.string().max(160);

/**
 * One retrieval question for the starter, with its answer (v12). A prerequisite one of the
 * objectives needs and the lesson does not teach, examples included (v16), so a pupil can answer
 * it before this lesson teaches anything; the outline places the three on the starter slide.
 */
export const PlanRetrievalQuestionSchema = z.strictObject({
  question: z.string().min(8).max(200),
  answer: z.string().min(1).max(120),
});
export type PlanRetrievalQuestion = z.output<typeof PlanRetrievalQuestionSchema>;

/**
 * Exactly three: the prose says "three" and Luna writes to the number it is given, so the schema
 * pins it rather than buying tolerance. Optional at the top level so a recorded set, a
 * `fromFacts` rerun or the bench parses without it; the sketch shows the slot, so a live call
 * fills it.
 */
const retrieval = z.array(PlanRetrievalQuestionSchema).length(3).optional();

/** With a curriculum extract: every objective must carry its anchor. */
const AnchoredOutputSchema = z.strictObject({
  objectives: z
    .array(z.strictObject({ text: objectiveText, curriculumAnchor }))
    .min(1)
    .max(4),
  retrieval,
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
  retrieval,
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
  retrieval,
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

/**
 * The shape sketch: one line, so no model spends its budget copying a worked example. One
 * retrieval item shown (the count is in the prose): the term the sample objective rests on
 * ("why the Romans invaded" needs "empire"), a prerequisite a Year 4 pupil could get wrong, not
 * v12/v13's Iron Age item, which was trivia with its answer in the question. No anchor: the field
 * is asked for beside an extract (`CURRICULUM_USE`), so a no-extract call is not shown the slot.
 */
const SHAPE_SKETCH =
  '{ "objectives": [{ "text": "Explain why the Romans invaded Britain" }], "retrieval": [{ "question": "What is an empire?", "answer": "Many lands and peoples ruled by one country or ruler" }] }';

export const planObjectivesPrompt = {
  version: "plan-objectives.v19",
  system: [
    "You are an experienced UK teacher writing one lesson's learning objectives and three retrieval questions for its starter.",
    "",
    OBJECTIVE_HOUSE_RULES,
    "Each objective is one idea, at most 16 words, starting with one observable verb. Name the actual concepts, and each method with the finished result it produces (a fully factorised expression); where it covers several factors, methods or strategies, name them.",
    "Levels rise: Recall (names or states), Explain (how or why), Apply (uses a method), Evaluate (judges, with a reason). The lesson's verb is its reach: every objective sits at that verb unless a lower level is genuinely needed (a method before judging, a definition the class lacks); the last sits at that verb, none above, none over two levels below. Where the class is new to the topic and the reach is Apply or Evaluate, start one level below the reach unless there is only one objective.",
    "Give one objective for each distinct part of the topic, so together they cover its core at this year group's level and no two share an idea: two or three; one only when the topic is a single method or skill; four only for four distinct parts; no filler line. A topic about several needs, factors, causes or methods has a part for each, or for each close pair.",
    "No objective restates the topic.",
    "Each retrieval question checks a different term, fact or method that an objective needs pupils to know already, one a pupil in this year group could plausibly have forgotten. None asks what the lesson teaches, its examples included. Ask it in one line or by picking from options the question names; it has one right answer.",
    "",
    "JSON, in this shape:",
    SHAPE_SKETCH,
  ].join("\n"),
  user(input: PlanObjectivesInput): string {
    const [shapeLine] = shapeBlock(input.shape);
    const parts = [`Topic or objective: ${input.topic}`, audienceBlock(input.audience)];
    if (input.priorKnowledge) {
      parts.push(`${PRIOR_KNOWLEDGE_LABEL}: ${input.priorKnowledge}`, PRIOR_KNOWLEDGE_USE);
    }
    parts.push(`Lesson shape: ${shapeLine}`);
    if (input.curriculum) {
      parts.push("", CURRICULUM_INSTRUCTION, input.curriculum.text, "", CURRICULUM_USE);
    }
    return parts.join("\n");
  },
} as const;
