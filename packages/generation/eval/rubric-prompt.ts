import type { LessonFacts } from "@tj/domain/documents";
import { z } from "zod";
import {
  type Audience,
  audienceBlock,
  example,
  factsBlock,
  HOUSE_RULES,
} from "../src/prompts/shared";

/*
 * The eval's rubric judge (ADR 0025 §23 amendment, project "Generation quality" §7): one
 * structured call on the `frontier` class that scores a whole generated lesson on eight
 * dimensions, 1–5, with a one-line rationale each. Eval-only — it is not in `src/prompts`, not in
 * `PROMPTS`, not pinned by `prompts.test.ts`, and never runs in production. Rationales are kept in
 * the gitignored results file only (ADR 0015); the scores and their deltas go to the PR comment.
 */

export const RUBRIC_DIMENSIONS = [
  "correctness",
  "depth",
  "pitch",
  "coherence",
  "questionQuality",
  "notes",
  "worksheetValueAdd",
  "imageFit",
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

const ScoreSchema = z.number().int().min(1).max(5);
const Rationale = z.string().max(300);

/** Seven dimensions always carry a score; a `null` there would be a dimension quietly dropped. */
const ScoredDimensionSchema = z.strictObject({ score: ScoreSchema, rationale: Rationale });
/** `imageFit` alone may be `null`: a lesson without a placed photograph has nothing to score. */
const OptionalDimensionSchema = z.strictObject({
  score: ScoreSchema.nullable(),
  rationale: Rationale,
});

export const RubricOutputSchema = z.strictObject({
  dimensions: z.strictObject({
    correctness: ScoredDimensionSchema,
    depth: ScoredDimensionSchema,
    pitch: ScoredDimensionSchema,
    coherence: ScoredDimensionSchema,
    questionQuality: ScoredDimensionSchema,
    notes: ScoredDimensionSchema,
    worksheetValueAdd: ScoredDimensionSchema,
    imageFit: OptionalDimensionSchema,
  }),
});

export type RubricOutput = z.infer<typeof RubricOutputSchema>;

export type RubricJudgeInput = {
  audience: Audience;
  topic: string;
  facts: LessonFacts;
  /** Every slide in order: the plain-text projection and the teacher notes. */
  slides: { index: number; kind: string; text: string; notes: string }[];
  /** Every worksheet block in order. */
  blocks: { type: string; text: string }[];
  /** Whether any `image-text` slide carries a placed photograph; `imageFit` is scored only then. */
  hasPlacedPhoto: boolean;
};

const ANCHORS: Record<RubricDimension, { what: string; one: string; three: string; five: string }> =
  {
    correctness: {
      what: "every stated fact, answer and worked step is right and consistent with the facts",
      one: "a pupil would be taught something wrong (a wrong answer, a wrong definition, an invented term)",
      three: "nothing wrong, but a term or answer is imprecise or inconsistent between slides",
      five: "everything is right, precise and consistent across facts, slides and worksheet",
    },
    depth: {
      what: "the explanation phase actually teaches the key ideas",
      one: "one content slide restating vocabulary definitions; no build-up, example or misconception",
      three:
        "key ideas are stated with an example, but at least one is asserted rather than explained",
      five: "each key idea is explained with an example and the misconception it heads off is named",
    },
    pitch: {
      what: "language, examples and demand fit the year group and reading level given",
      one: "vocabulary or sentence length is clearly above or below the year group, or the topic is outside the key stage",
      three: "mostly right; a few words or sentences a pupil at that level would struggle with",
      five: "reading level, sentence length and examples sit squarely with the audience",
    },
    coherence: {
      what: "the slides progress and build on each other without repeating",
      one: "slides repeat the same phrase or question, or the order does not build",
      three: "a clear order, but one or two slides restate what an earlier slide already said",
      five: "every slide adds something the others do not; the sequence reads like a planned lesson",
    },
    questionQuality: {
      what: "questions are answerable, the kind fits the task and distractors are plausible",
      one: "a degenerate question (duplicate options, a footnote as an item, a sort with no order) or a kind that does not fit",
      three:
        "answerable and fitting, but distractors are obvious or the questions test recall only",
      five: "well-formed, kind fits, distractors are named misconceptions, a mix of recall and reasoning",
    },
    notes: {
      what: "the teacher notes say what to say and ask",
      one: "notes are empty, generic or contain repair commentary or house-rule language",
      three:
        "notes summarise the slide but do not name a question to ask or a misconception to watch",
      five: "notes name what to say, a question to ask and the misconception to head off",
    },
    worksheetValueAdd: {
      what: "the worksheet adds practice rather than repeating the slides",
      one: "blocks copy slide stems verbatim; nothing new to practise",
      three: "some new items, but most blocks reuse slide or exit-ticket questions",
      five: "new practice at three tiers that extends what the slides taught",
    },
    imageFit: {
      what: "each image-text slide's text sets tasks that can be done from its photograph",
      one: "the text asks pupils to spot things the photograph does not show, or says 'pictures' when there is one",
      three: "the photograph relates to the text, but at least one task set cannot be done from it",
      five: "every task the text sets is doable from the picture as shown",
    },
  };

const rubricLines = (): string[] =>
  RUBRIC_DIMENSIONS.flatMap((d) => {
    const a = ANCHORS[d];
    return [`- \`${d}\` — ${a.what}. 1: ${a.one}. 3: ${a.three}. 5: ${a.five}.`];
  });

export const rubricJudgePrompt = {
  version: "rubric-judge.v1",
  system: [
    "You are an experienced UK head of department reviewing one generated lesson: its slides, teacher notes and worksheet, against the facts it was built from and the class it is for.",
    "Score the lesson on eight dimensions, each from 1 (poor) to 5 (excellent), with one sentence of rationale each that names the evidence you used. Be strict: a competent teacher's own lesson scores 4; 5 is reserved for lessons with nothing you would change.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Score what is in front of you, not what the topic could have been. Do not rewrite or add content.",
    "Where the lesson has no image-text slide with a photograph, `imageFit` has `score: null` and the rationale says so; every other dimension always has an integer score.",
    "",
    "Dimensions:",
    ...rubricLines(),
    "",
    "Answer as JSON in this shape:",
    example({
      dimensions: {
        correctness: {
          score: 4,
          rationale: "All answers match the facts; the boiling-point value is used consistently.",
        },
        depth: {
          score: 2,
          rationale: "One content slide restates the vocabulary; no worked example builds on it.",
        },
        pitch: {
          score: 4,
          rationale: "Short sentences and familiar examples suit the year group.",
        },
        coherence: {
          score: 3,
          rationale: "The exit ticket repeats the second slide's question word for word.",
        },
        questionQuality: {
          score: 3,
          rationale:
            "Distractors on the multiple choice are plausible; the sort has no real order.",
        },
        notes: { score: 2, rationale: "Notes restate the slide text and name no question to ask." },
        worksheetValueAdd: { score: 2, rationale: "Six of eight blocks copy slide stems." },
        imageFit: { score: null, rationale: "No image-text slide carries a photograph." },
      },
    }),
  ].join("\n"),
  user(input: RubricJudgeInput): string {
    return [
      audienceBlock(input.audience),
      `Topic: ${input.topic}`,
      "",
      factsBlock(input.facts),
      "",
      "Slides (in order):",
      ...input.slides.map(
        (s) =>
          `[slide ${s.index}, ${s.kind}]\n${s.text}${s.notes ? `\nTeacher notes: ${s.notes}` : ""}`,
      ),
      "",
      "Worksheet blocks (in order):",
      ...(input.blocks.length > 0
        ? input.blocks.map((b) => `[${b.type}] ${b.text}`)
        : ["(no worksheet)"]),
      "",
      input.hasPlacedPhoto
        ? "At least one image-text slide carries a photograph; score `imageFit` from its text."
        : "No image-text slide carries a photograph: `imageFit` must have `score: null`.",
      "",
      "Answer with the rubric JSON.",
    ].join("\n");
  },
} as const;
