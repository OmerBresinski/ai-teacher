import { QUESTION_TIERS, QUESTION_USES } from "@tj/domain/documents";
import { editorialIssue, SPEC_LIMITS, type SpecSchemaOptions } from "@tj/slides";
import { z } from "zod";
import { leadingVerb, verbLevel } from "../objectives-check";
import type { LessonShape } from "../shapes";
import { distractorsEchoingAnswer } from "../specs";
import { CURRICULUM_INSTRUCTION, PRIOR_KNOWLEDGE_LABEL } from "./plan-objectives";
import { shapeBlock } from "./shape";
import { type Audience, audienceBlock, houseRules } from "./shared";

/*
 * Plan, facts call, one objective at a time (F06-R13; ADR 0025 §17). The objectives call runs
 * first, then ONE OF THESE PER OBJECTIVE IN PARALLEL, so the lesson's facts land in the time of
 * the slowest single call instead of the sum. `plan-facts` is the latency pole of Plan (17 Sept
 * 2026: 19.5 s Gemini, 39 s Luna, 70 s Terra, 2.2–3.5k output tokens plus reasoning); one
 * objective is about a third of that answer, so the wall-clock is about a third.
 *
 * This call writes NO outline and NO minutes: which slide carries which fact is assigned later, in
 * code or its own call. A key idea, misconception, term or question carries no `objectiveRefs`
 * either — each serves the one objective it was given, so the caller sets `objectiveRefs` to
 * `[{ type: "objective", index: target }]` on merge and the model never spends a token on an
 * ordinal it cannot get wrong. A worked example is the exception since v9: a method can serve more
 * than one objective, and the outline used to guess which, so the call declares them.
 * `misconceptionRef` is kept in the shape `specs.ts` already uses, because a worked example or a
 * distractor that heads off the misconception is worth keeping: this call writes exactly one
 * misconception, so the caller remaps any ref it finds to that misconception's position in the
 * merged list, whatever index the model wrote.
 *
 * Every field below is a SUBSET of the matching item in `planFactsShape` (`specs.ts`) — same keys,
 * same key order, same `SPEC_LIMITS` caps — so merging N of these into `LessonFacts` is a
 * concatenation plus the two ordinal fixes above, with no transformation of the content.
 *
 * Provider-neutral: it runs on gpt-5.6-luna and gemini-3.8-flash through the gateway with
 * structured JSON output, so the system text is kept small, every rule is stated rather than
 * shown, and the shape sketch is one line (a worked example would be copied at length and this is
 * a latency change first). Bump `version` whenever `system` or `user` changes wording
 * (`shape.ts`, `shared.ts` and the two constants imported from `plan-objectives.ts` included).
 *
 * v2 (19 Sept 2026, BENCH-facts-1, 60 hand-graded calls) adds three rules and pays for them by
 * tightening the existing ones, so the word budget the pin test guards is unchanged:
 *  - Invention: the concrete rule below made models fabricate statistics on topics that have none
 *    (Year 12 economics: "UK petrol demand had a short-run PED of roughly −0.2"). A made-up
 *    scenario is now allowed where it belongs and must be flagged; a real figure must come from
 *    the curriculum extract or be checkable, and an uncertain one is dropped, not estimated.
 *  - Register: Gemini wrote "violent equestrian metaphor" for Year 11 and "hypocaust" as Year 4
 *    vocabulary, so the shared pitch house rule is pinned to a concrete anchor for every field.
 *  - Quotation length: 4 of 12 Macbeth Evaluate calls overran `option`/`answer` even with the
 *    1.5× tolerance, so the caps line now says how long a quotation or a distractor may be.
 * Cross-call duplicate misconceptions (Gemini, evolution) are NOT a prompt problem: a call sees
 * only its own objective, and the caller dedupes on merge.
 *
 * v3 (22 Sept 2026): the worked-example floor follows the shape, not the verb. v2 required one only
 * on Apply, but Explain's `requiredKinds` has a `worked-example` slide too, and the Y6 evolution
 * lesson (Explain, New to it) came back with none across all three objectives, so its outline
 * could not meet its shape. Now the lesson's LAST objective (its reach) must carry one whenever the
 * shape requires the slide, and every other objective may write 0–1 — including on Apply, which
 * v2 floored on every objective. `carriesWorkedExample` decides it; the user turn carries the
 * result as one line and the schema's floor reads the same function. The system line also says
 * what a worked example is without a calculation (the steps annotate a model answer, as the shape
 * table already says for Apply). Paid for in words by trims elsewhere, so the budget holds.
 *
 * v4 (22 Sept 2026): v3 regressed Apply. On Y6 ratio (round7, Luna) the two "Calculate…"
 * objectives before the reach came back with no worked example (v2: 3/3), because v3's line for
 * them — "none, unless this objective asks pupils to carry out a method" — left the call to the
 * model, and Luna did not read "calculate" as a method. The decision is now code, not judgement:
 * a worked example is REQUIRED on (a) every objective whose leading verb is at Apply level
 * (`verbLevel(leadingVerb(…))`, the objectives check's own table) and (b) the last objective when
 * the shape needs a `worked-example` slide. Every other call in such a lesson is told "none", with
 * no hedge, so the filler round5 wrote on a Recall objective cannot come back.
 *
 * v5 (23 Sept 2026, minimalism rubric; 448 -> 350 system words). Three correctness fixes, each named
 * to the bench output it answers (BENCH-luna6 facts, gpt-5.6-luna, `facts-luna6-facts/RESULTS.md`):
 *  - Circular definitions: on the three briefs re-benched (Romans, ratio, evolution) 2 of 30
 *    definitions used a word of their own term, both "ratio part" ("…the sum of the ratio numbers",
 *    "…split using a ratio"); the economics brief added "Price elasticity of demand" as "…when
 *    price changes…". v4's "define a term without using it" was read as the whole term; the rule
 *    now bars every word of the term. v5, v6, v6b: 0 of 24 by the same count.
 *  - The same term defined twice: "ratio part" under three ratio objectives with three wordings,
 *    "settlement", "forum" and "rebellion" under two Romans objectives each. v5 added a rule for
 *    it; v7 removes it again (see below), because merge dedupes by term and the bench reports the
 *    count.
 *  - Quantities without units: worked-example steps "35 ÷ 7 = 5." and "84 ÷ 12 = 7." (ratio) with
 *    the unit appearing only in the answer. One rule covers every field.
 * Removed, because schema or code enforces it (the counts line, "steps in order, answer last",
 * tier/use enums, the tolerance sentence) or because no bench failure on the model in use needs it
 * (the register anchor was a Gemini fault; "the diagram shows", the question-depth list, the
 * curriculum-extract restatement of `CURRICULUM_INSTRUCTION`). The distractor count moved from a
 * rule into the shape sketch, which shows three. The user turn no longer renders lesson length:
 * nothing here reads it (ruling 82).
 *
 * v6 (23 Sept 2026, same day): v5's first live round (facts-c-v5, Luna, 3 calls completed) needed a
 * second attempt on 3 of 3 calls, against 1 in 15 under v4. The counts line was the one deleted
 * rule that no other channel carries: `minItems`/`maxItems` reach OpenAI's schema but its
 * non-strict route does not enforce them, and a sketch's `[{…}]` reads as "one or more". The line
 * is back, as the counts only. v6 also put the ref's literal shape into the `misconceptionRef`
 * rule on a guess; v7 takes that back (below).
 *
 * v7 (23 Sept 2026, after the rubric judge; 369 -> 317 system words). Nothing added. Removed:
 *  - The ref shape from the misconception rule, back to v5's "say so in misconceptionRef": no
 *    bench row names the ref (facts-c-v5 records attempt counts only), and v6 changed two things
 *    at once, so its 0/11 cannot credit the shape. The sketch leaves the optional key out on
 *    purpose, and a rule that renders it is the shape a second time (rubric 2).
 *  - "a term an earlier objective needs first is defined there": `merge-objective-facts.ts` dedupes
 *    vocabulary by normalised term, first occurrence wins and the later objective is appended to
 *    `objectiveRefs`. Code that repairs silently is not restated (rubric 5); the bench's
 *    "merge duplicates" column is the metric.
 *  - "A key idea's example names a date, place, person… never a line true of any topic" (v1, from
 *    the monolithic call) and "Tier core is this objective's own standard…" (v5's rewording of
 *    v4's tier clause): no bench round names an output either fixes (rubric 3). The tier enum is
 *    schema; the concrete-example rule's only measured effect was v2's invention problem.
 *  - "with its correction": `correction` is a required field (rubric 5).
 * Measured (facts-c-v7, Luna, 9 calls, $0.018): 0 schema retries, 0 circular definitions of 16,
 * 0 unitless steps of 18, 1 term defined by two calls (merge repaired it), refs on 24 items.
 *
 * v8 (23 Sept 2026, same day; 317 -> 331 system words): the tier line comes back as a coverage
 * rule, on a failure v7 named. Without any tier line 5 of 9 calls used two tiers and the evolution
 * lesson had no "stretch" question in 10 (v6/v6b, with the definition line: 1 of 11 calls, every
 * lesson all three; luna6, v4's "tier them easy, core and stretch": 3 of 30, every lesson all
 * three). `specs.ts` requires each tier at the lesson level and the worksheet and exit ticket draw
 * on them; this call's schema holds only the enum, so the count is prose: at least one question at
 * each tier. What "core" means is still not defined, since no bench output needed that.
 * Measured (facts-c-v8, Luna, 9 calls, $0.016): every call three tiers, every lesson 3+ at each;
 * 0 schema retries, 0 unitless steps of 18, 0 merge duplicates, 1 answer over its cap (editorial).
 *
 * v9 (23 Sept 2026, review pack np1; 331 -> 368 system words): the call declares three things code
 * used to guess after it (Greg: code never judges meaning). A worked example's `objectiveRefs` is
 * required — the outline took `ownersOf[x] ?? [o]`; a question declares `demand` (recall | apply |
 * judgement) and `forms`, the ways it can be set — the outline read `distractors.length >= 3` as
 * multiple-choice. The sketch shows each once and one rule defines the enum words; the objectives
 * are listed by 0-based index, as the monolithic call listed them, so a ref copies the number shown
 * and the per-call schema bounds it to the list. Cut, on the rubric judge: "one pupils really hold,
 * not a slip" — BENCH-facts-1 graded "misconception real" and it passed, so there is no failure
 * to name (rubric 3). `durationMin` leaves the input (ruling 82). The shared house rules lost
 * their "JSON only" line the same day (`shared.ts`: `call.ts` repairs and validates the text).
 * Measured (facts-c-v9, Luna, 9 calls, $0.013): 0 schema retries; 5 of 5 worked examples with
 * refs, own objective included, all in range (none named a second objective); 32 of 32 questions
 * with demand (recall 7, explanation 11, apply 9, judgement 5) and forms; every call three tiers;
 * 0 unitless steps of 19; 1 definition of 16 using a word of its term ("ratio part"; v8 1 of 16,
 * "Roman settlement"). Declaring forms changed the neighbour: three distractors on 16 of 32
 * questions (v8: 32 of 32, the sketch's slots), and 2 questions declared multiple-choice with two
 * distractors, a mismatch code can check. Two calls took 83 s and 110 s (v8 max 18.5 s): gateway
 * tail, not attributed to the prompt.
 *
 * v10 (23 Sept 2026, np1 grounded arm; system text unchanged, 368 words): a `reference` input and
 * one user-turn line (`REFERENCE_INSTRUCTION`) after the curriculum extract. The lab's grounded arm
 * had been appending a pack section's facts to the `curriculum` slot, under an instruction that
 * calls the text a unit extract and asks for anchors (harness.md spec 8). The pack-fill call
 * (`eval/packs/prompts.ts`) reuses this system text with its counts sentence rewritten, so a
 * wording change here moves that hash too. Not measured live beyond one smoke call.
 *
 * v11 (23 Sept 2026, np1 root cause RC1 follow-up; 368 -> 384 system words): a question declares
 * `keyIdeaRefs`, the key ideas it tests, by index in the call's own `keyIdeas` (`merge-objective-
 * facts.ts` maps them to lesson positions). The outline puts two key ideas on one content slide
 * and withholds a question whose key idea has no slide; with only `objectiveRefs` that gate was
 * per objective, so a question on the taught idea was withheld with its untaught sibling. One slot
 * in the sketch and one clause on the demand/forms rule; "every one a pupil needs" keeps the gate
 * from placing a question that needs both ideas when one is taught. Optional in the schema: a
 * missing or out-of-range ref drops to the per-objective gate in code rather than costing a retry
 * on the slowest call in the fan-out, and the pack-fill call (questions without key ideas) cannot
 * be forced to name ideas it did not write.
 *
 * v12 (23 Sept 2026, np1 root cause RC2 / SYNTHESIS fix 4; system text unchanged): the reference
 * line no longer says "keeping their terms". Under it the grounded arm copied the Luna cells pack
 * whole, centrosome, spindle and microtubules included, into a Year 7 lesson (np1-cells-grounded:
 * 29 such terms in facts, 13 on slides; judged pitch 2 against live's 4). The line now keeps the
 * facts and terms right for the year group (named in the audience block) and says to leave the
 * rest out: an explicit way out, which Luna takes where "use them where they fit" gave none. The
 * pack-fill call's user turn carries the same constant.
 *
 * v13 (24 Sept 2026, W0 answer tells; 384 -> 436 system words): one rule on multiple-choice
 * options. The `answer` doubles as the open-response model answer, so Luna wrote it as a full
 * sentence with a full stop while the limits line made each distractor "one short phrase": the
 * correct option was strictly the longest in 13 of 14 MC questions and the only one with a full
 * stop in 11 (facts-tells-v12, 3 briefs; lab checks mc-tell-longest / mc-tell-punctuation). The
 * rule gives the method, not only the goal (Luna guide 3): the answer as a short option within
 * the distractor cap, distractors in its form, one at least as long, no full stops. "A distractor
 * is one short phrase" leaves the limits line, now said once in the rule. `generate-slide` copies
 * question, answer and distractors verbatim, so the fix lives here only. First wording, "the
 * answer is shown as one option among the distractors", was read as a placement: Luna copied the
 * answer into `distractors` in 8 of 9 MC questions (facts-tells-v13a). Now "beside its
 * distractors" and "each distractor, a wrong option".
 *
 * v14 (24 Sept 2026, cb SYNTHESIS cause 5, 12 of 14 traced runs; 436 -> 487 system words). The
 * judges marked what the prompt never asked for. Each rule below names the lab output it answers
 * (`cb/attrib/*-L.attrib.md`, Luna, v13); the log is `quality-prd/lab/r1/prompt.md`.
 *  - A key idea's example is one named case, and the worked example and questions take their own:
 *    Y4-L k1 "Britain had valuable resources, including metals" and k4 "A town might have a forum"
 *    restate the statement; Y11-L k3–k6 name no reaction (`no-concrete` fired on four); Y10-L o1
 *    had no quotation in either attempt while o2 and o3, which quoted, were the calls the judges
 *    passed ("quotation" is in the list for that). Y11-L x1 (20 g powder vs lumps) reappears as
 *    its exit question almost word for word; Y5-L's worked example repeated the key idea's
 *    example; Y8-L o3's steps were the key ideas again. The v2 invention sentence is unchanged.
 *  - Pitch covers numbers and problem steps: Y5-L amounts up to 35, one step even on stretch. The
 *    shared "Pitch the language" house rule is filtered out of this call and its two clauses,
 *    reading level and "explain any word", kept in the one sentence that replaces it.
 *  - Two quick "exit" questions per objective: no v13 line said what "exit" meant, so Y4-L o1
 *    wrote none and every other call marked its stretch judgement essay "exit" (Y4 o2/o3, Y10
 *    o3/o1, Y11 o1/o2/o3, Y8 o2, Y13 o1); judges scored flow 1 and practice 2 on "three extended
 *    written answers". Count: the outline (lab/r1s) draws per objective one cycle's check set of
 *    2–4 short questions plus 2 exit items for a 4–6 item quiz across objectives, so 4–6 per
 *    objective is the smallest supply; the prose says "four to six", the schema ceiling is 6 and
 *    the floor stays 3 as tolerance (a short answer is not a retry on the slowest call; recorded
 *    3-question fixtures still parse). The starter is the outline's own selection, not a marked
 *    question here: `merge-objective-facts.ts` strips `keyIdeaRefs`, so an empty list cannot
 *    carry a signal, and "any" keeps its meaning (flexible use, `plan-facts.ts`).
 *  - A distractor is a wrong option a pupil reaches by a real error: Y4-L "To learn how to build
 *    pyramids", "Only farms and villages" ×3; Y11-L "The reaction stops immediately"; Y5-L
 *    "Add 6 counters to 24 counters"; Y10-L "Ariel's island". One clause inside the v13 rule,
 *    keeping its measured wording ("wrong option", "beside its distractors"); "wording" joins
 *    length and punctuation in the tell the rule describes, for the shared "Only".
 *  - Cut: "You see the lesson's objectives and the one to write for" (the user turn shows it).
 * Not added, on rubric 3: a stem-contains-answer rule (Y10-L, one case; a code check is the
 * cheaper fix), "each key idea has a question" (Y5-L, one case; `keyIdeaRefs` gives code the
 * signal), the four-option lists that repeat the answer (w0b schema check already retries), an
 * invention allowance for key-idea examples (Y11-L, one case).
 * Not measured live: the A/B against v13 follows this commit.
 *
 * v15 (26 Sept 2026, E48; `quality-prd/lab/DIAG-ratio-checks.md` gap 1): no wording change. The
 * worked-example decision (`carriesWorkedExample`) also floors an objective whose phrase names a
 * method after "how/why (to)" (`namesMethod`), so "Explain how to simplify a ratio" before the
 * reach is "required", not "none". Bumped because the rendered user line changes for such inputs.
 */

export type PlanFactsObjectiveInput = {
  topic: string;
  /** The lesson's shape, from the brief's answers and the class (`lessonShapeOf`). */
  shape: LessonShape;
  audience: Audience;
  /** Every objective the lesson teaches, in order: the target one, and the lanes to stay out of. */
  objectives: { text: string }[];
  /** Which of `objectives` this call writes the facts for; 0-based, rendered as listed. */
  target: number;
  /** The brief's class-context prior-knowledge line, when the teacher gave one. Optional. */
  priorKnowledge?: string | undefined;
  /** The curriculum extract retrieved for this brief: a unit, not this lesson's plan. Optional. */
  curriculum?: { text: string } | undefined;
  /**
   * Checked reference facts for THIS objective (v10): a topic pack section's facts, plain lines
   * with no ids. The grounded arm and the fill call (`eval/pack-arms.ts`) set it; production does
   * not. Optional; rendered after the curriculum extract under `REFERENCE_INSTRUCTION`.
   */
  reference?: { text: string } | undefined;
};

/**
 * How the reference facts are introduced (v10; v12 replaced "where they fit … keeping their terms"
 * with the year-group filter). One line: what they are (checked, for this objective), how to use
 * them (the ones pitched for the class, in the call's own words; the rest left out). The
 * curriculum slot used to carry them under `CURRICULUM_INSTRUCTION`, which describes a unit
 * extract and says "anchor each objective", neither true of reference facts (harness.md spec 8).
 */
export const REFERENCE_INSTRUCTION =
  "Reference facts for this objective, already checked: use those right for this year group, in your own words, and leave out any fact or term pitched above it.";

/**
 * A text slot, exactly as `specs.ts` builds one (`lineFor`): non-empty (shape), and in the strict
 * build capped as an editorial issue. The soft build drops the cap only, so a retry that overran a
 * cap and nothing else is accepted and recorded as an editorial miss for Repair (TEACH-257) — the
 * parallel fan-out makes a second retry the whole lesson's latency. BENCH-facts-2 (19 Sept 2026,
 * 24 calls on the Evaluate briefs): every schema failure here was a cap, `workedExamples.0.answer`
 * and `questions.N.reasoning`, and the monolithic facts call never failed on them because it has
 * this switch.
 */
const lineFor =
  (soft: boolean) =>
  (max: number): z.ZodString => {
    const base = z.string().trim().min(1);
    return soft
      ? base
      : base.refine(
          (text) => text.length <= max,
          editorialIssue(`Too long: at most ${max} characters.`),
        );
  };

/** A text slot builder, as `lineFor` returns one: the only thing the soft build changes. */
type Line = (max: number) => z.ZodString;

/** The ordinal `specs.ts` uses for a misconception; here there is one, so the model writes 0. */
const MisconceptionOrdinalSchema = z.strictObject({
  type: z.literal("misconception"),
  index: z.number().int().nonnegative(),
});

/**
 * The ordinal `specs.ts` uses for an objective (v9). A live call bounds `index` to the objectives
 * it listed (`max` reaches the provider's JSON schema; a stray one is a retry, not a bad ref); the
 * general schema, for callers that parse any lesson, leaves it open.
 */
const objectiveOrdinalSchema = (count?: number) =>
  z.strictObject({
    type: z.literal("objective"),
    index:
      count === undefined
        ? z.number().int().nonnegative()
        : z
            .number()
            .int()
            .min(0)
            .max(Math.max(count - 1, 0)),
  });

/**
 * What a question asks of the pupil, declared by the call (v9), never read off its tier, its
 * position or its wording. The four are the objective verb ladder in the words the objectives call
 * uses (Recall, Explain, Apply, Evaluate), so a question's demand can be set against the lesson's
 * verb structurally. `merge-objective-facts.ts` reads it as optional.
 */
export const QUESTION_DEMANDS = ["recall", "explanation", "apply", "judgement"] as const;
export type QuestionDemand = (typeof QUESTION_DEMANDS)[number];

/**
 * The ways one question with one answer can be set on a slide (v9): the kinds the outline chooses
 * a practise slide from. `discussion` has no single answer, `matching`, `sort` and `fill-gap` need
 * their own items, and nothing downstream reads them, so they are not forms here.
 */
export const QUESTION_FORMS = ["multiple-choice", "true-false", "open-response"] as const;
export type QuestionForm = (typeof QUESTION_FORMS)[number];

const keyIdeaSchema = (line: Line) =>
  z.object({
    statement: line(SPEC_LIMITS.item),
    explanation: line(SPEC_LIMITS.body),
    example: line(SPEC_LIMITS.body),
    analogy: line(SPEC_LIMITS.item).optional(),
  });

const misconceptionSchema = (line: Line) =>
  z.object({
    belief: line(SPEC_LIMITS.item),
    correction: line(SPEC_LIMITS.body),
  });

const vocabularySchema = (line: Line) =>
  z.object({
    term: line(SPEC_LIMITS.term),
    definition: line(SPEC_LIMITS.definition),
  });

const workedExampleSchema = (line: Line, objectiveCount?: number) =>
  z.object({
    problem: line(SPEC_LIMITS.body),
    steps: z.array(line(SPEC_LIMITS.item)).min(1).max(6),
    answer: line(SPEC_LIMITS.answer),
    objectiveRefs: z.array(objectiveOrdinalSchema(objectiveCount)).min(1),
    misconceptionRef: MisconceptionOrdinalSchema.optional(),
  });

/**
 * w0b: a distractor that repeats the answer (`distractorsEchoingAnswer`: case, whitespace and
 * sentence punctuation aside) is an editorial issue in the strict build, so the call retries; the
 * soft build accepts it and the outline drops the question from multiple choice. Schema only: the
 * system text and its hash are unchanged.
 */
const questionSchema = (line: Line, soft: boolean) =>
  z.preprocess(dropExtraAnswerDistractor, questionShape(line)).superRefine((q, ctx) => {
    if (soft) return;
    for (const j of distractorsEchoingAnswer(q))
      ctx.addIssue(
        editorialIssue(
          "This distractor repeats the answer: every option must differ from the correct one.",
          ["distractors", j, "text"],
          "distractor-equals-answer",
        ),
      );
  });

/**
 * r1: Luna's retries list the answer itself as a fourth distractor ("A", then the three wrong
 * options): 3 of 3 retried calls in CB/r1, each failing the three-distractor cap and losing the
 * objective. When there are more than three and one repeats the answer, that one is dropped before
 * parsing; with three or fewer an echo stays an editorial miss, since a real distractor is missing.
 */
function dropExtraAnswerDistractor(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const q = value as { answer?: unknown; distractors?: unknown };
  if (typeof q.answer !== "string" || !Array.isArray(q.distractors) || q.distractors.length <= 3)
    return value;
  const texts = q.distractors.map((d) => ({ text: typeof d?.text === "string" ? d.text : "" }));
  const echoes = new Set(distractorsEchoingAnswer({ answer: q.answer, distractors: texts }));
  if (echoes.size === 0) return value;
  return { ...q, distractors: q.distractors.filter((_, j) => !echoes.has(j)) };
}

const questionShape = (line: Line) =>
  z.object({
    stem: line(SPEC_LIMITS.stem),
    answer: line(SPEC_LIMITS.answer),
    reasoning: line(SPEC_LIMITS.footnote),
    tier: z.enum(QUESTION_TIERS),
    use: z.enum(QUESTION_USES),
    demand: z.enum(QUESTION_DEMANDS),
    forms: z.array(z.enum(QUESTION_FORMS)).min(1),
    keyIdeaRefs: z
      .array(z.strictObject({ type: z.literal("keyIdea"), index: z.number().int().min(0).max(1) }))
      .optional(),
    distractors: z
      .array(
        z.object({
          text: line(SPEC_LIMITS.option),
          misconceptionRef: MisconceptionOrdinalSchema.optional(),
        }),
      )
      .max(3)
      .optional(),
  });

/**
 * What one objective's facts call may return. The lists are in the order `planFactsShape` declares
 * them and the order the model must write them in: misconceptions before the worked examples and
 * questions that refer to one. Item objects are `z.object`, not `strictObject` (TEACH-256): a
 * model that adds `objectiveRefs` to a key idea, or `explanation` to a worked example, has the
 * stray key stripped instead of costing the slowest call in a parallel fan-out a retry. The outer
 * object stays strict, so an invented list is still a parse error.
 *
 * The counts are a third of a whole lesson's: one or two key ideas, the objective's own
 * misconception, and enough questions to tier it and to feed the starter, the checks and the
 * exit quiz (v14: the prose asks for four to six, two of them exit; the floor
 * here stays 3 so a short answer is accepted, not retried on the slowest call of the fan-out,
 * and the recorded 3-question fixtures still parse). The prose states the target and the schema
 * buys tolerance (CORE 2026-09-16); the number is in the system text and nowhere else.
 * `objectiveCount` bounds a worked example's refs to the objectives the call listed; left out,
 * any index parses.
 */
function planFactsObjectiveShape(workedExamplesMin: 0 | 1, soft: boolean, objectiveCount?: number) {
  const line = lineFor(soft);
  return z.strictObject({
    keyIdeas: z.array(keyIdeaSchema(line)).min(1).max(2),
    misconceptions: z.array(misconceptionSchema(line)).min(1).max(1),
    vocabulary: z.array(vocabularySchema(line)).max(2),
    workedExamples: z
      .array(workedExampleSchema(line, objectiveCount))
      .min(workedExamplesMin)
      .max(1),
    questions: z.array(questionSchema(line, soft)).min(3).max(6),
  });
}

/** The general form: a worked example is optional, for callers and the bench that parse any lesson. */
export const PlanFactsObjectiveOutputSchema = planFactsObjectiveShape(0, false);
export type PlanFactsObjectiveOutput = z.output<typeof PlanFactsObjectiveOutputSchema>;

/** Which call a worked-example floor is decided for: the lesson's shape and this call's place in it. */
export type PlanFactsObjectivePosition = Pick<
  PlanFactsObjectiveInput,
  "shape" | "objectives" | "target"
>;

/** An Apply-level verb in `word`, read through its -s, -es, -ies and -ing forms ("simplifies", "dividing"). */
function isApplyWord(word: string | undefined): boolean {
  if (!word) return false;
  const stems = [word];
  if (word.endsWith("ies")) stems.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("es")) stems.push(word.slice(0, -2));
  if (word.endsWith("s")) stems.push(word.slice(0, -1));
  if (word.endsWith("ing")) {
    const base = word.slice(0, -3);
    stems.push(base, `${base}e`);
    if (/(.)\1$/.test(base)) stems.push(base.slice(0, -1));
  }
  return stems.some((stem) => verbLevel(stem) === "Apply");
}

/**
 * v15: whether an objective names a method, read from its words against the objectives check's own
 * verb table. Either its leading verb is at Apply level ("Calculate…", "Solve…"), or the phrase
 * after "how" or "why" (optionally "how to") opens on one ("Explain how to simplify…", "Explain
 * how dividing…", "Explain why adding…"): an Explain objective about carrying out a procedure,
 * in any subject. "Explain how the Romans used roads" is not: the word after "how" is no verb.
 */
export function namesMethod(objective: { text: string } | undefined): boolean {
  if (objective === undefined) return false;
  if (isApplyWord(leadingVerb(objective.text))) return true;
  const words = objective.text.toLowerCase().split(/[^a-z]+/);
  return words.some((word, i) => {
    if (word !== "how" && word !== "why") return false;
    const next = words[i + 1] === "to" ? words[i + 2] : words[i + 1];
    return isApplyWord(next);
  });
}

/**
 * v4: whether THIS call must return a worked example, decided in code from the objective and the
 * shape, never left to the model. Required on (a) an objective that names a method
 * (`namesMethod`: an Apply-level leading verb, or, since v15, "how/why (to) <method verb>") — a
 * method is shown worked — and (b) the lesson's last objective (its reach, held at the shape's
 * verb by the objectives check) when the shape needs a `worked-example` slide (Explain and Apply
 * today, read from `requiredKinds`), so the outline can always meet its shape. A Recall "Define…"
 * objective before the reach gets none. The prompt's user turn and the schema both read this, so
 * the line and the floor cannot drift.
 */
export function carriesWorkedExample(position: PlanFactsObjectivePosition): boolean {
  const reach = position.target === position.objectives.length - 1;
  return (
    namesMethod(position.objectives[position.target]) ||
    (reach && position.shape.requiredKinds.includes("worked-example"))
  );
}

/**
 * The schema for one call. Where `carriesWorkedExample` holds, the worked example is required: a
 * required slot is the only instruction a prose rule cannot lose to (CORE 2026-08-04). Everywhere
 * else the floor is 0 and a worked example earns its place or is left out.
 *
 * `{ soft: true }` builds the same schema without the text caps, for `callStructured`'s `soft`, as
 * `planFactsSchemaFor` does for the monolithic call: the stage passes both, and a retry that only
 * overran a cap is accepted and carried as an editorial miss instead of failing the lesson. The
 * counts, the enums and the worked-example floor are shape and hold in both builds.
 */
export function planFactsObjectiveOutputSchemaFor(
  position: PlanFactsObjectivePosition,
  options: SpecSchemaOptions = {},
): z.ZodType<PlanFactsObjectiveOutput> {
  const required = carriesWorkedExample(position);
  return planFactsObjectiveShape(
    required ? 1 : 0,
    options.soft === true,
    position.objectives.length,
  );
}

/**
 * The user-turn worked-example line, on every call of a lesson where any call is required to write
 * one: "required" on those calls, "none" on the rest. The system text names the line and no verb
 * or objective: the decision is made in code, per call, and only its result reaches the model (CORE
 * 2026-09-16: defer to the packet line). A lesson where no call is required gets no line, and the
 * system's "only where it teaches better than prose" stands alone.
 *
 * Both lines are measured. round5, with only the "required" line (Luna, Y6 evolution and Y4
 * Romans), wrote a worked example on all six objectives, one of them filler on a Recall "Name two
 * reasons" objective. round7, with "none, unless this objective asks pupils to carry out a method",
 * dropped the ratio lesson's two "Calculate…" objectives to zero. So the line states the decision
 * and never hedges it. The schema still allows 0–1 on a "none" call: a stray example is accepted
 * rather than costing a retry on the slowest call in the fan-out.
 */
function workedExampleLine(position: PlanFactsObjectivePosition): string | undefined {
  const anyRequired = position.objectives.some((_, target) =>
    carriesWorkedExample({ ...position, target }),
  );
  if (!anyRequired) return undefined;
  return carriesWorkedExample(position)
    ? "Worked example: required for this objective."
    : "Worked example: none for this objective.";
}

/**
 * The house rules, less two lines. The `factRefs` line: this call is given no fact ids and its
 * schema has no `factRefs`, so the sentence is an instruction about a field that does not exist
 * here. The "Pitch the language" line (v14): this call pitches numbers and problem steps as well
 * as language (Y5-L: amounts up to 35 and one step on every question, stretch included), and one
 * sentence saying all three, with the house rule's "explain any word" clause kept, replaces it
 * rather than standing beside it.
 */
const FACTS_HOUSE_RULES = houseRules("british", "names");

/**
 * The caps `specs.ts` and `@tj/slides` enforce, stated so the model does not learn them from a
 * retry. Not `limitsBlock`: this call's system text has a word budget and the shared block's
 * per-field list and closing sentence cost about a fifth of it. The numbers are still
 * `SPEC_LIMITS`, so nothing here can drift from what the schema checks.
 *
 * The last sentence is v2: a character cap is a number a model cannot feel, and the Evaluate
 * briefs that broke it all broke it the same way — a quotation copied whole into a stem, an
 * answer or a distractor. Saying how long a quotation may be is the rule it can actually follow.
 * Kept in v5 although the caps are schema: `refine` caps never reach the provider's JSON schema,
 * so this line is the only place the model meets the numbers, and a miss is an editorial repair.
 */
const LENGTH_LIMITS = `Length limits (characters): statement, belief and step ${SPEC_LIMITS.item}; explanation, example, problem and correction ${SPEC_LIMITS.body}; term ${SPEC_LIMITS.term}; definition ${SPEC_LIMITS.definition}; stem and answer ${SPEC_LIMITS.stem}; reasoning ${SPEC_LIMITS.footnote}; distractor ${SPEC_LIMITS.option}. A quotation is one line, cut with an ellipsis.`;

/**
 * The shape sketch: one line of placeholders, so no model spends its budget copying content. The
 * optional `misconceptionRef` is left out of it deliberately — a slot in a template gets filled
 * whatever the prose says (CORE 2026-08-04), and a ref is right only where a worked example or a
 * distractor really heads the misconception off. The rule above names the key instead.
 *
 * Minified in v2: the keys and placeholders are unchanged, the spaces between them carried no
 * instruction, and a JSON sketch is read the same either way. v5 shows three distractor slots: the
 * count is shape, so it lives here and not in a rule (schema caps it at 3, floors it nowhere). v9
 * adds the three declarations as slots: a required field is filled whatever the prose says.
 * Exported for the pack-fill call (`eval/packs/prompts.ts`), which shows the lists it wants and no
 * others: it takes them from this sketch, so its shape cannot drift from the schema it picks from.
 */
export const SHAPE_SKETCH =
  '{"keyIdeas":[{"statement":"…","explanation":"…","example":"…"}],"misconceptions":[{"belief":"…","correction":"…"}],"vocabulary":[{"term":"…","definition":"…"}],"workedExamples":[{"problem":"…","steps":["…"],"answer":"…","objectiveRefs":[{"type":"objective","index":0}]}],"questions":[{"stem":"…","answer":"…","reasoning":"…","tier":"core","use":"slide","demand":"apply","forms":["multiple-choice","open-response"],"keyIdeaRefs":[{"type":"keyIdea","index":0}],"distractors":[{"text":"…"},{"text":"…"},{"text":"…"}]}]}';

export const planFactsObjectivePrompt = {
  version: "plan-facts-objective.v15",
  system: [
    "You are an experienced UK teacher writing one lesson's substance, one objective at a time.",
    "Other calls write the others: do not teach them here.",
    "",
    "Rules:",
    FACTS_HOUSE_RULES,
    "Pitch the language, numbers and problem steps at the year group and reading level given; explain any word a pupil at that level would not know.",
    "Write one or two key ideas, one misconception, up to two vocabulary terms, and four to six questions.",
    "A key idea's example is one named case showing the explanation at work (a place, person, event, reaction, quotation or worked numbers); the worked example and each question take a case of their own.",
    'A worked example or question may invent its scenario and numbers, saying so ("a shop", "suppose"); a key idea\'s date, figure or case is real, from the curriculum extract or checkable by the class, and an uncertain figure is left out, never estimated.',
    "Every quantity carries its unit, in each step and answer as well as the question: 35 ÷ 7 = 5 stickers, not 5.",
    "Vocabulary is the terms this objective introduces and the class will not know, or none. A definition uses none of the term's own words, only words the class already has.",
    'Questions cover all three tiers: at least one "easy", one "core" and one "stretch".',
    'Two questions are for "exit" use, each answered in one line or by choosing an option.',
    'Where a worked example or distractor heads off the misconception, say so in "misconceptionRef".',
    'Where "forms" includes multiple-choice, pupils see the answer beside its distractors. Write the answer as a short phrase within the distractor limit, then each distractor, a wrong option a pupil reaches by a real error (the misconception, a neighbouring idea, a wrong step), in the same form, with at least one as long as the answer and no option ending in a full stop, so length, punctuation and wording never give the answer away.',
    'Follow the brief\'s worked-example line. A worked example is the method on one problem; without a calculation, its steps annotate a model answer. Its "objectiveRefs" list every objective it serves, by index, this one included.',
    '"demand" is what the question asks of the pupil: recall (name or state), explanation (how or why), apply (use the method) or judgement (decide, with a reason). "forms" lists every way the question can be set: multiple-choice, true-false, open-response. "keyIdeaRefs" lists every key idea a pupil needs to answer it, by index from 0.',
    `Where the brief gives "${PRIOR_KNOWLEDGE_LABEL}", treat it as met and build nothing outside it.`,
    LENGTH_LIMITS,
    "",
    "JSON, in this shape:",
    SHAPE_SKETCH,
  ].join("\n"),
  user(input: PlanFactsObjectiveInput): string {
    const [shapeLine] = shapeBlock(input.shape);
    const parts = [`Topic or objective: ${input.topic}`, audienceBlock(input.audience)];
    if (input.priorKnowledge) {
      parts.push(`${PRIOR_KNOWLEDGE_LABEL}: ${input.priorKnowledge}`);
    }
    parts.push(`Lesson shape: ${shapeLine}`, "", "Objectives of the lesson, by index:");
    input.objectives.forEach((objective, i) => {
      parts.push(`  ${i}: ${objective.text}`);
    });
    const target = input.objectives[input.target];
    parts.push("", `Write the facts for objective ${input.target}: ${target?.text ?? ""}`);
    const workedExample = workedExampleLine(input);
    if (workedExample) parts.push(workedExample);
    if (input.curriculum) parts.push("", CURRICULUM_INSTRUCTION, input.curriculum.text);
    if (input.reference) parts.push("", REFERENCE_INSTRUCTION, input.reference.text);
    return parts.join("\n");
  },
} as const;
