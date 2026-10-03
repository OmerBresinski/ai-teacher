import { FIGURE_TEMPLATE_NAMES, type FigureTemplateName } from "@tj/domain/documents";
import { editorialIssue, SPEC_LIMITS, type SpecSchemaOptions } from "@tj/slides";
import { z } from "zod";
import {
  carriesWorkedExample,
  type PlanFactsObjectiveInput,
  type PlanFactsObjectivePosition,
  REFERENCE_INSTRUCTION,
} from "./plan-facts-objective";
import { CURRICULUM_INSTRUCTION } from "./plan-objectives";
import { shapeBlock } from "./shape";
import { audienceBlock, houseRules, type Retrieval, retrievalBlock } from "./shared";

/*
 * Plan, teach call, one objective at a time (lab/pw, wave 2; 24 Sept 2026). `plan-facts-objective`
 * v14 with the questions taken out: key ideas, the misconception, vocabulary and the worked
 * example, the text the slides teach from. Questions are written afterwards by
 * `plan-question-set`, one call per (objective, use), each given this call's output verbatim so
 * every question is answerable from what the slides will say.
 *
 * Why the split: the facts call is the latency pole of Plan (~2.5k output tokens at ~55 tok/s,
 * 31–58 s), questions are 51% of its answer, and 45% of the questions it writes are never placed
 * (169 written, 92 used across 12 decks). The outline now decides how many questions each
 * objective needs before any question is written.
 *
 * Every rule here is v14's wording where the rule concerns this call's fields; the rules that
 * concern questions (tiers, exit, the multiple-choice options, demand/forms/keyIdeaRefs) moved to
 * `plan-question-set.ts` and nothing was added. The per-rule provenance is v14's header
 * (`plan-facts-objective.ts`); the routing table is `quality-prd/lab/pw/prompts.md`.
 *
 * Output: the same four lists as v14, same keys, key order and `SPEC_LIMITS` caps, so
 * `mergeObjectiveFacts` takes `{ ...teach, questions }` unchanged once the question sets are
 * appended. The item schemas are restated here rather than imported because v14 does not export
 * them; when v14 retires, move them here and import from this file.
 *
 * Input: `PlanFactsObjectiveInput` plus the starter's questions (`retrieval`, contract C1).
 *
 * v2 (24 Sept 2026 audit, FIX-PLAN B1/B7): prior knowledge is read from the audience block alone
 * (it was sent twice, under two labels); the starter's questions are shown as earlier learning, so
 * a prerequisite the starter asks is not taught again as new. B7 (keep content inside the key
 * stage) was tried and not kept: on the Y2 plants brief, "teaching nothing beyond that year group's
 * key stage" and a national-curriculum variant both still wrote "leaves make food" in 6 of 6 runs
 * (Luna guide rule 8: an instruction does not overturn the model's framing; the source does).
 * `priorKnowledge` stays on the input type for the callers and is no longer rendered.
 *
 * v3 (l6j, 26 Sept 2026; `quality-prd/lab/DIAG-ratio-checks.md` gap 1): an unfloored call was told
 * "Worked example: none for this objective.", so a method taught under a non-final Explain
 * objective ("Explain how dividing by a common factor simplifies a ratio") never got one, and its
 * finished form (simplest form) was absent from the facts of 10 of 15 Y7 ratio decks. Code still floors Apply
 * verbs and the reach; the other calls now read "one if this objective involves a method pupils
 * carry out; otherwise none", which keeps none as the default for prose objectives (the filler the
 * bare "none" line was added against, CORE 2026-09-22). The worked-example rule gains "taken to its
 * finished form", so a method is not stopped part way. Not yet measured.
 *
 * v5 (TEACH-163, 3 Oct 2026; ruling 147a): each key idea may say what would picture it, in an
 * optional `picture`: a photo (`subject`, what pupils should `notice`), a diagram (a shipped
 * Figure `template`, what it `shows`), or `none`. The outline had only the key idea's prose to
 * guess from and placed 1 picture in 3 lessons. The slot is in the sketch (Luna fills a sketched
 * optional slot, openai.md 2026-09-23); "none" names the failure to exclude, decoration, rather
 * than a genre (openai.md 2026-09-26, the diagram swing). Code reads it in `outline-pictures.ts`:
 * photo maps to `ImageBrief` (`subject`, `mustShow` = `notice`), diagram to `FigureBrief`
 * (`template`, `purpose` = `shows`). A malformed picture parses as absent (`.catch`), so the slot
 * never costs the fan-out's slowest call a retry; saved v4 runs parse unchanged.
 */

export type PlanTeachObjectiveInput = PlanFactsObjectiveInput & {
  /** The starter's retrieval questions (C1): earlier learning, not taught here. Optional. */
  retrieval?: Retrieval | undefined;
};

/** A text slot as `specs.ts` builds one; the soft build drops the cap only (see v14 `lineFor`). */
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
 * What each shipped Figure template draws, in the words the system line shows the model (v5).
 * Keyed by `FigureTemplateName`, so a new template does not compile until it is described here.
 */
const FIGURE_TEMPLATE_GLOSS: Record<FigureTemplateName, string> = {
  "right-triangle": "Pythagoras or trigonometry",
  triangle: "a triangle's angles or area",
  "energy-profile": "a reaction's energy change",
};

/**
 * v5: what would picture a key idea. No character caps here: an over-long subject would drop the
 * whole picture under `.catch`. The prose asks for `ImageBriefSchema`'s subject cap (60) in the
 * limits line, and the outline clips to the domain caps (subject 60, `mustShow` 120 each,
 * `FigureBrief.purpose` 160) when it maps the value. First smoke: a 1-of-3 subject ran to 87.
 */
const pictureSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("photo"),
    subject: z.string().trim().min(1),
    notice: z.array(z.string().trim().min(1)).min(1).max(4),
  }),
  z.object({
    kind: z.literal("diagram"),
    template: z.enum(FIGURE_TEMPLATE_NAMES),
    shows: z.string().trim().min(1),
  }),
  z.object({ kind: z.literal("none") }),
]);
export type KeyIdeaPicture = z.output<typeof pictureSchema>;

const keyIdeaSchema = (line: Line) =>
  z.object({
    statement: line(SPEC_LIMITS.item),
    explanation: line(SPEC_LIMITS.body),
    example: line(SPEC_LIMITS.body),
    analogy: line(SPEC_LIMITS.item).optional(),
    picture: pictureSchema.optional().catch(undefined),
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
 * What one objective's teach call may return: v14's shape minus `questions`. Lists in the order
 * `planFactsShape` declares them; item objects `z.object` so a stray key is stripped, the outer
 * object strict so an invented list is a parse error. Counts as v14: one or two key ideas, one
 * misconception, up to two terms, 0–1 worked example (floored per call by `carriesWorkedExample`).
 */
export function planTeachObjectiveShape(
  workedExamplesMin: 0 | 1,
  soft: boolean,
  objectiveCount?: number,
) {
  const line = lineFor(soft);
  return z.strictObject({
    keyIdeas: z.array(keyIdeaSchema(line)).min(1).max(2),
    misconceptions: z.array(misconceptionSchema(line)).min(1).max(1),
    vocabulary: z.array(vocabularySchema(line)).max(2),
    workedExamples: z
      .array(workedExampleSchema(line, objectiveCount))
      .min(workedExamplesMin)
      .max(1),
  });
}

/** The general form: a worked example is optional, for callers that parse any lesson. */
export const PlanTeachObjectiveOutputSchema = planTeachObjectiveShape(0, false);
export type PlanTeachObjectiveOutput = z.output<typeof PlanTeachObjectiveOutputSchema>;

/**
 * The schema for one call: the worked-example floor from `carriesWorkedExample` (v4 rule, code
 * decides), refs bounded to the objectives listed, `{ soft: true }` without the text caps.
 */
export function planTeachObjectiveOutputSchemaFor(
  position: PlanFactsObjectivePosition,
  options: SpecSchemaOptions = {},
): z.ZodType<PlanTeachObjectiveOutput> {
  return planTeachObjectiveShape(
    carriesWorkedExample(position) ? 1 : 0,
    options.soft === true,
    position.objectives.length,
  );
}

/**
 * The worked-example line: "required" on a call `carriesWorkedExample` floors; on the others (v3)
 * the call decides from its objective, default none. No line when no call is floored.
 */
export function workedExampleLine(position: PlanFactsObjectivePosition): string | undefined {
  const anyRequired = position.objectives.some((_, target) =>
    carriesWorkedExample({ ...position, target }),
  );
  if (!anyRequired) return undefined;
  return carriesWorkedExample(position)
    ? "Worked example: required for this objective."
    : "Worked example: one if this objective involves a method pupils carry out; otherwise none.";
}

/** The house rules less the `factRefs` line (no ids here) and the language-only pitch line (v14). */
const TEACH_HOUSE_RULES = houseRules("british", "names");

/** v14's limits line, the question fields removed. */
const LENGTH_LIMITS = `Length limits (characters): statement, belief and step ${SPEC_LIMITS.item}; explanation, example, problem and correction ${SPEC_LIMITS.body}; term ${SPEC_LIMITS.term}; definition ${SPEC_LIMITS.definition}; answer ${SPEC_LIMITS.answer}; subject 60. A quotation is one line, cut with an ellipsis.`;

/** v14's sketch without the `questions` list; `misconceptionRef` left out on purpose (v7). */
export const TEACH_SHAPE_SKETCH =
  '{"keyIdeas":[{"statement":"…","explanation":"…","example":"…","picture":{"kind":"photo","subject":"…","notice":["…"]}}],"misconceptions":[{"belief":"…","correction":"…"}],"vocabulary":[{"term":"…","definition":"…"}],"workedExamples":[{"problem":"…","steps":["…"],"answer":"…","objectiveRefs":[{"type":"objective","index":0}]}]}';

/** v5: the picture rule, its template list rendered from `FIGURE_TEMPLATE_GLOSS`. */
const PICTURE_RULE = `A key idea's "picture" is what would show it to the class: a photo of something real pupils can look at, with its "subject" and what pupils should "notice"; a diagram where one of these templates draws the idea, preferred to a photo then, with its "template" and what it "shows": ${FIGURE_TEMPLATE_NAMES.map((t) => `${t} (${FIGURE_TEMPLATE_GLOSS[t]})`).join(", ")}; otherwise {"kind":"none"}, when nothing pupils could see explains the idea or a picture would only decorate it.`;

export const planTeachObjectivePrompt = {
  version: "plan-teach-objective.v5",
  system: [
    "You are an experienced UK teacher writing what one lesson teaches, one objective at a time.",
    "Other calls write the questions and the other objectives: do not write them here.",
    "",
    "Rules:",
    TEACH_HOUSE_RULES,
    "Pitch the language, numbers and problem steps at the year group and reading level given; explain any word a pupil at that level would not know.",
    "Write one or two key ideas, one misconception and up to two vocabulary terms.",
    "A key idea's example is one named case showing the explanation at work (a place, person, event, reaction, quotation or worked numbers); the worked example takes a case of its own.",
    'A worked example may invent its scenario and numbers, saying so ("a shop", "suppose"); a key idea\'s date, figure or case is real, from the curriculum extract or checkable by the class, and an uncertain figure is left out, never estimated.',
    "Every quantity carries its unit, in each step and answer as well as the problem: 35 ÷ 7 = 5 stickers, not 5.",
    "Vocabulary is the terms this objective introduces and the class will not know, or none. A definition uses none of the term's own words, only words the class already has.",
    'Where the worked example heads off the misconception, say so in "misconceptionRef".',
    PICTURE_RULE,
    'Follow the brief\'s worked-example line. A worked example is the method on one problem, taken to its finished form; without a calculation, its steps annotate a model answer. Its "objectiveRefs" list every objective it serves, by index, this one included.',
    'Where the brief gives "Prior knowledge", treat it as met and build nothing outside it.',
    LENGTH_LIMITS,
    "",
    "JSON, in this shape:",
    TEACH_SHAPE_SKETCH,
  ].join("\n"),
  user(input: PlanTeachObjectiveInput): string {
    const [shapeLine] = shapeBlock(input.shape);
    const parts = [`Topic or objective: ${input.topic}`, audienceBlock(input.audience)];
    parts.push(`Lesson shape: ${shapeLine}`, "", "Objectives of the lesson, by index:");
    input.objectives.forEach((objective, i) => {
      parts.push(`  ${i}: ${objective.text}`);
    });
    parts.push(...retrievalBlock(input.retrieval));
    const target = input.objectives[input.target];
    parts.push(
      "",
      `Write what the lesson teaches for objective ${input.target}: ${target?.text ?? ""}`,
    );
    const workedExample = workedExampleLine(input);
    if (workedExample) parts.push(workedExample);
    if (input.curriculum) parts.push("", CURRICULUM_INSTRUCTION, input.curriculum.text);
    if (input.reference) parts.push("", REFERENCE_INSTRUCTION, input.reference.text);
    return parts.join("\n");
  },
} as const;
