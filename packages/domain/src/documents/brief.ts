import { z } from "zod";
import { type ClassContext, ClassContextSchema } from "./class-context";
import { guarded } from "./identifier-guard";

/*
 * Brief (ADR 0024 §1; F01). What the teacher states before generation: the topic or objective,
 * the duration, optional class context and the answers to at most two clarifying questions. It
 * holds only what the Lesson does not already carry — `subject`, `yearGroup`, `ageBand`,
 * `readingLevel` and `language` stay canonical on the Lesson and are not duplicated here. Stored
 * as the optional `Lesson.brief` field, so a TeachDeck file without one is still a valid document.
 */

export const BRIEF_TOPIC_MAX = 500;
export const BRIEF_ANSWER_MAX = 500;
export const BRIEF_DURATION_MIN = 5;
export const BRIEF_DURATION_MAX = 180;
/** F01: "at most two clarifying questions, each with a default the teacher can accept". */
export const MAX_CLARIFYING_QUESTIONS = 2;

export type Brief = {
  /** Topic or objective, free text. */
  topic: string;
  durationMin: number;
  classContext?: ClassContext;
  /** Answers to the clarifying questions, keyed by the question id the brief screen chose. */
  answers?: Record<string, string>;
};

export const BriefSchema = z.strictObject({
  topic: guarded(z.string().min(1).max(BRIEF_TOPIC_MAX)),
  durationMin: z.number().int().min(BRIEF_DURATION_MIN).max(BRIEF_DURATION_MAX),
  classContext: ClassContextSchema.optional(),
  answers: z
    .record(z.string().min(1).max(64), guarded(z.string().max(BRIEF_ANSWER_MAX)))
    .refine((answers) => Object.keys(answers).length <= MAX_CLARIFYING_QUESTIONS, {
      message: `At most ${MAX_CLARIFYING_QUESTIONS} clarifying questions can be answered.`,
    })
    .optional(),
});
