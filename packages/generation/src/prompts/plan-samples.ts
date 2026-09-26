import { lessonShapeOf } from "../shapes";
import { audienceOf } from "../stages/shared";
import { sampleBriefLesson } from "../testing";
import type { PlanFactsObjectiveInput } from "./plan-facts-objective";
import type { PlanObjectivesInput } from "./plan-objectives";
import type { PlanQuestionSetInput } from "./plan-question-set";
import type { PlanTeachObjectiveInput } from "./plan-teach-objective";
import { PlanTeachObjectiveOutputSchema } from "./plan-teach-objective";

/*
 * Test-only, like `hash.ts`: the sample inputs the four plan prompts are rendered with. Their
 * pins live in `prompts.test.ts` (`PINNED`, ADR 0025 §17); each prompt's own test reuses the
 * same sample for its wording checks.
 */

const audience = audienceOf(sampleBriefLesson());

const SHAPE = lessonShapeOf(
  { objectiveVerb: "Explain the Roman invasion of Britain", priorConfidence: "New to it" },
  { yearGroup: "Year 4" },
);

/** Year 4 with a whole unit, so the count rule and the curriculum instruction are in the hash. */
export const PLAN_OBJECTIVES_SAMPLE: PlanObjectivesInput = {
  topic: "The Roman invasion of Britain",
  audience: { ...audience, subject: "History", yearGroup: "Year 4" },
  shape: SHAPE,
  curriculum: {
    text: [
      "Programme of study: the Roman Empire and its impact on Britain.",
      "Unit: The Roman Empire in Britain (6 lessons).",
      "Lesson 1 outcome: I can say where the Roman Empire was and when it began.",
      "Lesson 4 outcome: I can say why Boudica led a revolt.",
      "Key learning points: the Romans invaded Britain in AD 43; roads and towns changed daily life;",
      "Boudica's revolt was defeated in AD 61.",
      "Keywords: empire, invasion, revolt.",
      "Misconception: pupils think the Romans left no trace in Britain.",
    ].join("\n"),
  },
};

/** plan-facts-objective v14's sample: the lane wording, the target line and both instructions. */
export const PLAN_TEACH_OBJECTIVE_SAMPLE: PlanTeachObjectiveInput = {
  topic: "The Roman invasion of Britain",
  audience: { ...audience, subject: "History", yearGroup: "Year 4" },
  shape: SHAPE,
  objectives: [
    { text: "Explain why the Romans invaded Britain" },
    { text: "Explain how the Romans changed daily life in Britain" },
    { text: "Explain why Boudica led a revolt" },
  ],
  target: 1,
  curriculum: {
    text: [
      "Programme of study: the Roman Empire and its impact on Britain.",
      "Key learning points: the Romans invaded Britain in AD 43; roads and towns changed daily life;",
      "Boudica's revolt was defeated in AD 61.",
    ].join("\n"),
  },
  reference: { text: "- Term: villa — a large Roman country house with farmland." },
};

/** Two key ideas, an analogy and a worked example, so every branch of the taught block renders. */
export const PLAN_TAUGHT_SAMPLE = PlanTeachObjectiveOutputSchema.parse({
  keyIdeas: [
    {
      statement: "Roman roads let soldiers and goods move quickly between new towns.",
      explanation: "Straight, paved roads meant an army could march to trouble in days, not weeks.",
      example: "Watling Street ran from Dover to Wroxeter, about 250 miles.",
    },
    {
      statement: "Roman towns had a forum, baths and straight streets.",
      explanation: "A town was planned on a grid, with the forum as its market and meeting place.",
      example: "Colchester was the first Roman town in Britain.",
      analogy: "A forum was like a town square with a market on it.",
    },
  ],
  misconceptions: [
    {
      belief: "The Romans left no trace in Britain.",
      correction: "Roads, baths and town walls from Roman Britain still stand today.",
    },
  ],
  vocabulary: [{ term: "forum", definition: "The open square at the centre of a Roman town." }],
  workedExamples: [
    {
      problem: "Why did the Romans build a road from Dover to London?",
      steps: ["Dover is where soldiers landed.", "London was the biggest town."],
      answer: "So soldiers and supplies could reach the biggest town quickly.",
      objectiveRefs: [{ type: "objective", index: 1 }],
    },
  ],
});

/** The taught block plus an `avoid` list. */
export const PLAN_QUESTION_SET_SAMPLE: PlanQuestionSetInput = {
  topic: "The Roman invasion of Britain",
  audience: { ...audience, subject: "History", yearGroup: "Year 4" },
  shape: SHAPE,
  objective: "Explain how the Romans changed daily life in Britain",
  taught: PLAN_TAUGHT_SAMPLE,
  use: "exit",
  count: 2,
  avoid: ["How did Roman roads change trade in Britain?", "What was a forum for?"],
};

/** Three objectives, a curriculum unit and reference facts: the lane wording and target line. */
export const PLAN_FACTS_OBJECTIVE_SAMPLE: PlanFactsObjectiveInput = {
  topic: "The Roman invasion of Britain",
  audience: { ...audience, subject: "History", yearGroup: "Year 4" },
  shape: SHAPE,
  objectives: [
    { text: "Explain why the Romans invaded Britain" },
    { text: "Explain how the Romans changed daily life in Britain" },
    { text: "Explain why Boudica led a revolt" },
  ],
  target: 1,
  curriculum: {
    text: [
      "Programme of study: the Roman Empire and its impact on Britain.",
      "Key learning points: the Romans invaded Britain in AD 43; roads and towns changed daily life;",
      "Boudica's revolt was defeated in AD 61.",
      "Misconception: pupils think the Romans left no trace in Britain.",
    ].join("\n"),
  },
  reference: {
    text: [
      "- Key idea: Roads joined the new towns. Soldiers and goods moved fast. Example: Watling Street.",
      "- Term: villa — a large Roman country house with farmland.",
    ].join("\n"),
  },
};
