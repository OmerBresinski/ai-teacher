import { QUESTION_TIERS, QUESTION_USES } from "@tj/domain/documents";
import { editorialIssue, SPEC_LIMITS, type SpecSchemaOptions } from "@tj/slides";
import { z } from "zod";
import { LINE_MAX, MC_LINE_MAX } from "../planner/coded-slides";
import type { LessonShape } from "../shapes";
import { distractorsEchoingAnswer } from "../specs";
import { QUESTION_DEMANDS, QUESTION_FORMS } from "./plan-facts-objective";
import type { PlanTeachObjectiveOutput } from "./plan-teach-objective";
import { shapeBlock } from "./shape";
import { type Audience, audienceBlock, houseRules, type Retrieval, retrievalBlock } from "./shared";

/*
 * Plan, question-set call (lab/pw, wave 4; 24 Sept 2026): the questions for ONE objective and ONE
 * use ("slide" or "exit"), written after `plan-teach-objective` and the outline. The outline
 * decides how many questions each objective needs for its slides and for the exit quiz, and one of
 * these runs per (objective, use), all in parallel, each shown the objective's taught text (key
 * ideas, misconception, vocabulary, worked example) exactly as the teach call returned it.
 *
 * The rule that matters most answers the judged failure "tested but not taught" (cb SYNTHESIS;
 * CORE 2026-09-24, r3): every question must be answerable from the taught text alone. v14 wrote
 * questions and facts in one call and the slides then compressed the facts; here the question
 * writer sees the same text the slide writer gets, so what the question needs is what the slide
 * teaches. The Luna guide's first two rules shape the sentence: say what the checker sees (a judge
 * reads the question beside the taught text and nothing else) and rank the goals where they can
 * collide (answerable first, a case of its own second).
 *
 * Everything else is v14's question rules in v14's measured wording, moved here unchanged where
 * the field moved: units (v5), the multiple-choice option rule (v13, tells 93% -> 29%; v14's
 * real-error clause), the exit definition (v14 cause 5), `misconceptionRef` on a distractor (v7),
 * demand / forms / keyIdeaRefs (v9, v11), the invention allowance (v2), pitch of numbers and steps
 * (v14, Y5-L). Not carried: "explain any word a pupil would not know" (a stem cannot; the taught
 * vocabulary is what the class has), the prior-knowledge line, the curriculum extract and the
 * reference facts (each would invite a question the taught text cannot answer; Luna guide 12: no
 * input line the call does not use).
 *
 * Three things the split changes, none of them prose the model has to weigh:
 *  - The count is exact and comes from the outline, so it lives in the packet line ("Write 3
 *    "slide" questions") and the system text names the line, never a number (CORE 2026-09-16,
 *    10/10 on the objectives count line). The per-call schema pins `min(count).max(count)`: short is
 *    a gap on a slide, long is the waste this split removes.
 *  - `use` is fixed per call: the prose says to set it to the brief's use and the per-call schema
 *    pins it with `z.literal`, which reaches the provider's JSON schema as `const` (unlike a
 *    `refine`), so a wrong value is caught at decode on a strict route and by one retry here.
 *  - v8's tier rule ("at least one easy, one core and one stretch") assumed four to six questions
 *    per call; a two-question exit set cannot hold it. Code renders the tier line from the count
 *    (`tierLine`) and the system says to follow it.
 *
 * v2 (24 Sept 2026, Sonnet review): the sketch's `use` slot is the placeholder every other slot
 * uses ("…"), not "slide". The value is pinned per call by the schema, so a literal only invited
 * Luna to copy "slide" on exit calls. Soft-build count tolerance as described above
 * (`planQuestionSetShape`); the strict build stays exact.
 *
 * v4 (24 Sept 2026 audit, FIX-PLAN B3): "three distractors", with the way out the Luna guide (rule 7)
 * measured, leave multiple-choice out when three real errors are not there (18 of 92 items had two
 * or four, and the outline cannot set them); true-false only with a misconception-tagged
 * distractor and never on exit (the outline drops it otherwise); "any example in the taught text"
 * (every key idea has its own example, and three sets restated one); the system's "exit" sentence
 * is gone (EXIT_LINE says it), and on exit calls EXIT_LINE's caps replace the general ones, so an
 * exit distractor has one cap, not two. The `avoid` branch is worded as a plain instruction; the
 * exit call receives the slide set's stems (contract C4). The starter's questions render as
 * earlier learning (C1).
 *
 * Output item: EXACTLY v14's question item (same keys, key order, caps, enums), so `merge-objective-
 * facts.ts` and the outline read `{ ...teach, questions: [...sets] }` unchanged: `keyIdeaRefs`
 * index the taught key ideas as the block shows them (0-based), `misconceptionRef` index 0 is the
 * objective's one misconception. The question schema is restated from v14 because v14 does not
 * export it; when v14 retires, move it here.
 */

export const QUESTION_SET_USES = ["slide", "exit"] as const;
export type QuestionSetUse = (typeof QUESTION_SET_USES)[number];

export type PlanQuestionSetInput = {
  topic: string;
  /** The lesson's shape (`lessonShapeOf`): its first sentence names the verb and the class. */
  shape: LessonShape;
  audience: Audience;
  /** The objective these questions test, as the objectives call wrote it. */
  objective: string;
  /** The teach call's output for this objective, verbatim: what the slides will teach. */
  taught: PlanTeachObjectiveOutput;
  /** Where the outline will place the questions; every item's `use` must equal it. */
  use: QuestionSetUse;
  /** How many questions the outline needs for this use; the schema pins it exactly. */
  count: number;
  /** Stems already written for this objective's other set, when that set came first. Optional. */
  avoid?: string[] | undefined;
  /** The starter's retrieval questions (C1): earlier learning, not this lesson. Optional. */
  retrieval?: Retrieval | undefined;
};

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
type Line = (max: number) => z.ZodString;

const MisconceptionOrdinalSchema = z.strictObject({
  type: z.literal("misconception"),
  index: z.number().int().nonnegative(),
});

/** v14's question item; `use` and the `keyIdeaRefs` bound are per call, everything else the same. */
const questionShape = (line: Line, use?: QuestionSetUse, keyIdeaCount?: number) =>
  z.object({
    stem: line(SPEC_LIMITS.stem),
    answer: line(SPEC_LIMITS.answer),
    reasoning: line(SPEC_LIMITS.footnote),
    tier: z.enum(QUESTION_TIERS),
    use: use === undefined ? z.enum(QUESTION_USES) : z.literal(use),
    demand: z.enum(QUESTION_DEMANDS),
    forms: z.array(z.enum(QUESTION_FORMS)).min(1),
    keyIdeaRefs: z
      .array(
        z.strictObject({
          type: z.literal("keyIdea"),
          index: z
            .number()
            .int()
            .min(0)
            .max(keyIdeaCount === undefined ? 1 : Math.max(keyIdeaCount - 1, 0)),
        }),
      )
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

/** v14 r1: an answer listed as a fourth distractor is dropped before parsing. */
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

/** v14 w0b: a distractor repeating the answer is an editorial issue in the strict build. */
const questionSchema = (line: Line, soft: boolean, use?: QuestionSetUse, keyIdeaCount?: number) =>
  z
    .preprocess(dropExtraAnswerDistractor, questionShape(line, use, keyIdeaCount))
    .superRefine((q, ctx) => {
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
 * `{ questions: [...] }`. The general form takes any use and one or more questions; a call's form
 * (`planQuestionSetOutputSchemaFor`) pins the use, the count and the key-idea bound. The strict
 * build wants the count exactly; the soft build (v2) accepts max(1, count - 1) to count + 2, so a
 * one-item shortfall or a couple of extras on the retry is not a third attempt on a parallel call:
 * the caller keeps the first `count` and treats the shortfall as acceptable.
 */
function planQuestionSetShape(
  soft: boolean,
  use?: QuestionSetUse,
  count?: number,
  keyIdeaCount?: number,
) {
  const items = z.array(questionSchema(lineFor(soft), soft, use, keyIdeaCount));
  const questions =
    count === undefined
      ? items.min(1)
      : soft
        ? items.min(Math.max(1, count - 1)).max(count + 2)
        : items.min(count).max(count);
  return z.strictObject({ questions });
}

export const PlanQuestionSetOutputSchema = planQuestionSetShape(false);
export type PlanQuestionSetOutput = z.output<typeof PlanQuestionSetOutputSchema>;

/** The parts of the input the schema reads: the use, the count and the key ideas to index. */
export type PlanQuestionSetPosition = Pick<PlanQuestionSetInput, "use" | "count" | "taught">;

export function planQuestionSetOutputSchemaFor(
  position: PlanQuestionSetPosition,
  options: SpecSchemaOptions = {},
): z.ZodType<PlanQuestionSetOutput> {
  return planQuestionSetShape(
    options.soft === true,
    position.use,
    position.count,
    position.taught.keyIdeas.length,
  );
}

/**
 * The tier line for a set of `count` questions: v8's three-tier rule where the count can hold it,
 * the two the exit quiz and a short check set need below that. Code decides, the line carries it.
 */
export function tierLine(count: number): string {
  if (count >= 3) return 'Tiers: at least one "easy", one "core" and one "stretch".';
  if (count === 2) return 'Tiers: one "easy" and one "core".';
  return 'Tier: "core".';
}

/**
 * The taught text as the question writer sees it: `factsBlock`'s layout, with the key ideas and
 * the misconception numbered by the index `keyIdeaRefs` and `misconceptionRef` copy (0-based, as
 * the teach call's lists are), and nothing the teach call did not write.
 */
export function taughtBlock(taught: PlanTeachObjectiveOutput): string {
  const out = ["Key ideas, by index:"];
  taught.keyIdeas.forEach((k, i) => {
    out.push(`  ${i}: ${k.statement} — ${k.explanation}`, `    Example: ${k.example}`);
    if (k.analogy) out.push(`    Analogy: ${k.analogy}`);
  });
  if (taught.misconceptions.length > 0) {
    out.push("Misconceptions, by index:");
    taught.misconceptions.forEach((m, i) => {
      out.push(`  ${i}: believes ${m.belief}; correct: ${m.correction}`);
    });
  }
  if (taught.vocabulary.length > 0) {
    out.push("Vocabulary:");
    for (const v of taught.vocabulary) out.push(`  ${v.term} — ${v.definition}`);
  }
  for (const x of taught.workedExamples) {
    out.push(`Worked example: ${x.problem}`);
    x.steps.forEach((s, i) => {
      out.push(`  ${i + 1}. ${s}`);
    });
    out.push(`  Answer: ${x.answer}`);
  }
  return out.join("\n");
}

/** The house rules less the `factRefs` line (no ids here) and the language-only pitch line (v14). */
const QUESTION_HOUSE_RULES = houseRules("british", "names");

/** v14's limits line, the question fields only. */
const LENGTH_LIMITS = `Length limits (characters): stem and answer ${SPEC_LIMITS.stem}; reasoning ${SPEC_LIMITS.footnote}; distractor ${SPEC_LIMITS.option}. A quotation is one line, cut with an ellipsis.`;

/** v14's question item, unchanged, inside the one list this call writes. */
export const QUESTION_SET_SHAPE_SKETCH =
  '{"questions":[{"stem":"…","answer":"…","reasoning":"…","tier":"core","use":"…","demand":"apply","forms":["multiple-choice","open-response"],"keyIdeaRefs":[{"type":"keyIdea","index":0}],"distractors":[{"text":"…"},{"text":"…"},{"text":"…"}]}]}';

/**
 * v3 (pw prompts-2): the exit quiz prints each exit question as one line, and the outline leaves off
 * any that does not fit (`settable`: stem-only when under three distractors, else the multiple-choice
 * line with its four options). v2 said "one line" without the budget, and 33 of 111 l1/l2 exit
 * questions missed it (22 MC lines over 240, 8 stems over 160, 3 true-false only), each leaving its
 * objective off the ticket. The numbers are the outline's own caps, the MC line split into a stem and
 * per-option cap: one 220-character total still missed 7 of 33 on Luna (a model cannot sum five
 * fields); per-field caps are what it can count.
 */
const EXIT_MC_STEM = 100;
/** Four options share what the stem leaves of the line, less the letters and separators (16). */
const EXIT_OPTION = Math.floor((MC_LINE_MAX - EXIT_MC_STEM - 16) / 4 / 5) * 5;
export const EXIT_LINE = `Each is one line of the exit quiz: either multiple choice, with a stem of at most ${EXIT_MC_STEM} characters and the answer and each distractor at most ${EXIT_OPTION}; or "forms" ["open-response"] with no distractors and a stem of at most ${LINE_MAX} characters. These caps replace the general length limits.`;

/*
 * v5 (25 Sept 2026, luna-direct yes/no deck checklist, `lab/luna-direct/RESULTS.md`): on gpt-6-luna
 * low, 7 of 144 questions had a second defensible answer ("anotherCorrect", 0 on 5.6-luna low) and
 * 2 a wrong key. Most were "name one" items keyed to one answer where several are right ("Name
 * one hard engineering method…", "Which part of a plant can grow into a new plant?", "Write an
 * equivalent ratio to 18:30…"). A question now has one right answer, or its answer lists every
 * that is right; a distractor must be wrong by the taught text, which is the check
 * the judge applies. Distractors (37 throwaway in DIAGNOSIS FM2) start from the taught
 * misconception applied to the question's case; v4's separate misconceptionRef sentence is folded
 * into that clause.
 */

/*
 * v6 (26 Sept 2026, l6-b judged, `lab/l6-b/CHANGES-C.md`): v5's two question-set faults on round B
 * were one kind. "Which is its simplified form?" keyed 2:5 beside the option 4:10, and "Simplify
 * 8:12 by dividing both parts by the same common factor" keyed 2:3, where 4:6 also answers it. The
 * stem asked for a process a pupil can stop part way, and v5's "a wrong step" distractor was that
 * part-way answer, so it was right as the stem was worded. v5's "one right answer" states the goal
 * and Luna believed it met it. v6 gives the method: where a pupil could stop part way, the stem asks
 * for the finished form (+16 words; the rounding case is not observed, so not written). The "name one" half is unchanged.
 */

/*
 * v7 (26 Sept 2026, l6e; rounds C and D checklist, `lab/l6-e/CHANGES.md`): the two round-D keyWrong
 * flags were one kind, a Year 7 ratio key carrying units ("2 cm:3 cm", "It gives 2 ml:3 ml"), which
 * v1's "every quantity carries its unit" asked for; a simplified ratio compares like quantities and
 * has none. The unit rule gains that exception (+10 words). The other round-C/D flags were starter
 * items (the objectives call writes them; plan-objectives v21) or one-offs with no shared shape, so
 * nothing else is added here.
 */
export const planQuestionSetPrompt = {
  version: "plan-question-set.v7",
  system: [
    "You are an experienced UK teacher writing the questions for one objective of a lesson, for one use, from the text its slides will teach.",
    "",
    "Rules:",
    QUESTION_HOUSE_RULES,
    "Pitch the language, numbers and problem steps at the year group and reading level given.",
    'Write as many questions as the brief\'s "Write" line says, all for the use it names, and set "use" to that use.',
    'A judge reads each question beside the taught text and nothing else. What matters, in order: every question is answerable from the taught text alone, the fact, reason, method or quotation its answer needs being stated there; each takes a case of its own rather than repeating any example in the taught text, and may invent its scenario and numbers, saying so ("a shop", "suppose").',
    "Follow the brief's tier line.",
    "Every quantity carries its unit, in the answer and each option as well as the stem: 5 stickers, not 5. A ratio's parts carry none: 2:3, not 2 cm:3 cm.",
    'Each question has one right answer: where a pupil could stop part way, the stem asks for the finished form ("simplest form"); where several are right ("name one…"), "answer" lists each.',
    'Where "forms" includes multiple-choice, pupils see the answer beside its distractors. Write the answer as a short phrase within the distractor limit, then three distractors (without three real errors to use, leave multiple-choice out of "forms"), each wrong by the taught text and reached by a real error: the taught misconception applied to this case (give its "misconceptionRef"), a neighbouring idea or a wrong step. Write them in the same form, with at least one as long as the answer and none ending in a full stop, so length, punctuation and wording never give the answer away.',
    '"demand" is what the question asks of the pupil: recall (name or state), explanation (how or why), apply (use the method) or judgement (decide, with a reason). "forms" lists every way the question can be set: multiple-choice, true-false (only with a distractor that has a "misconceptionRef", never on exit), open-response. "keyIdeaRefs" lists every key idea a pupil needs to answer it, by the index shown.',
    LENGTH_LIMITS,
    "",
    "JSON, in this shape:",
    QUESTION_SET_SHAPE_SKETCH,
  ].join("\n"),
  user(input: PlanQuestionSetInput): string {
    const [shapeLine] = shapeBlock(input.shape);
    const parts = [
      `Topic or objective: ${input.topic}`,
      audienceBlock(input.audience),
      `Lesson shape: ${shapeLine}`,
      "",
      `Objective: ${input.objective}`,
      "",
      "Taught text for this objective, as the slides will say it:",
      taughtBlock(input.taught),
      ...retrievalBlock(input.retrieval),
    ];
    if (input.avoid && input.avoid.length > 0) {
      parts.push("", "Already asked of this objective; write different questions:");
      for (const stem of input.avoid) parts.push(`  - ${stem}`);
    }
    const noun = input.count === 1 ? "question" : "questions";
    parts.push("", `Write ${input.count} "${input.use}" ${noun}.`, tierLine(input.count));
    if (input.use === "exit") parts.push(EXIT_LINE);
    return parts.join("\n");
  },
} as const;
