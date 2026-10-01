import { z } from "zod";
import { type Audience, audienceBlock, example } from "./shared";

/*
 * Plan-write's exit ticket (round Q): one call, on the checker's model and effort, writes the
 * closing questions from what the teaching slides say. Round P built them in code and keyed
 * "explain how" questions with slide headings, which judges marked wrong 36 times in 16 decks.
 * Code then checks each item (`plan-write/model-exit.ts`): similarity to the lesson's own
 * questions, the sums in its answer, its multiple-choice key. Bump the version whenever the text
 * changes.
 */
export const EXIT_ITEMS_VERSION = "exit-items.v1";

export const EXIT_ITEM_FORMS = ["apply", "explain", "multiple-choice"] as const;

export type ExitItemsInput = {
  audience: Audience;
  topic: string;
  objectives: string[];
  /** How many items to write: code sets it from the objective count. */
  count: number;
  /** The teaching slides as written, notes and picture briefs left out. */
  slides: { number: number; form: string; written: Record<string, unknown> }[];
  /** Every question the lesson already asks. */
  asked: string[];
  /** On the re-ask: the items to write again, each with what was wrong. */
  redo?: { objective: number; form: string; question: string; problem: string }[];
};

export const exitItemsSchema = z.object({
  items: z.array(
    z.object({
      objective: z.number().int(),
      form: z.enum(EXIT_ITEM_FORMS),
      answer: z.string().trim().min(1),
      question: z.string().trim().min(1),
      wrongOptions: z.array(z.string().trim().min(1)),
    }),
  ),
});

export type ExitItemsOutput = z.infer<typeof exitItemsSchema>;

const EXAMPLE: ExitItemsOutput = {
  items: [
    {
      objective: 1,
      form: "apply",
      answer: "36 ÷ 3 = 12, so her average speed is 12 km per hour.",
      question: "A cyclist rides 36 km in 3 hours. What is her average speed?",
      wrongOptions: [],
    },
    {
      objective: 2,
      form: "multiple-choice",
      answer: "Metal carries heat away from your hand faster than wood.",
      question:
        "A metal spoon and a wooden spoon have sat in the same room all day. Why does the metal one feel colder?",
      wrongOptions: ["The metal spoon is at a lower temperature.", "Wood makes its own heat."],
    },
  ],
};

const SYSTEM = [
  "You are an experienced UK teacher writing the exit ticket that closes a lesson. Pupils answer it alone, on the slide and on the worksheet, to show whether they met each objective.",
  "",
  "Write the number of items you are asked for: one on each objective, in objective order, then any extra on the objective that most needs checking. Each item:",
  "- objective: the number of the objective it tests;",
  '- form: "apply" (use the method or idea on a new case), "explain" (say how or why) or "multiple-choice" (two or three wrong options, each a mistake a pupil in this lesson would really make). Use at least two different forms;',
  "- answer: the model answer a teacher marks against, written before the question. It answers the question in full in one sentence of at most 20 words: the working and result for an apply item, the reason itself for an explain item, the correct option for a multiple-choice item. Write any calculation as an equation with its result (15 ÷ 5 = 3);",
  "- question: at most 25 words, answerable from the slides alone, and new: not one of the lesson's questions reworded, and on a different case or angle from them;",
  "- wrongOptions: the wrong options for a multiple-choice item, otherwise [].",
  "",
  "Use only what the teaching slides teach: no fact, term or method they do not give.",
  "",
  "Answer as JSON in exactly this shape:",
  example(EXAMPLE),
].join("\n");

export function exitItemsPrompt(input: ExitItemsInput): { system: string; user: string } {
  return {
    system: SYSTEM,
    user: [
      audienceBlock(input.audience),
      `Topic: ${input.topic}`,
      "Objectives:",
      ...input.objectives.map((o, i) => `  ${i + 1}. ${o}`),
      `Items to write: ${input.count}`,
      "",
      "Teaching slides:",
      ...input.slides.map((s) => `Slide ${s.number} (${s.form}): ${JSON.stringify(s.written)}`),
      "",
      "The lesson's questions (do not repeat or reword):",
      ...input.asked.map((q) => `- ${q}`),
      ...(input.redo && input.redo.length > 0
        ? [
            "",
            "Write again only these items, each on the same objective, fixing the problem named:",
            ...input.redo.map(
              (r) =>
                `- objective ${r.objective}, ${r.form}: "${r.question}". Problem: ${r.problem}`,
            ),
          ]
        : []),
    ].join("\n"),
  };
}
