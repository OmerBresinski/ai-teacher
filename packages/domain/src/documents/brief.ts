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
/** The deck lengths a teacher may ask for (TDD ruling 75); `lessonFromBrief` defaults to 10. */
export const SLIDE_COUNTS = [6, 8, 10, 12] as const;
export type SlideCount = (typeof SLIDE_COUNTS)[number];
export const DEFAULT_SLIDE_COUNT: SlideCount = 10;
/** How hard the lesson is pitched relative to the year group (ruling 74). */
export const BRIEF_LEVELS = ["easier", "standard", "harder"] as const;
export type BriefLevel = (typeof BRIEF_LEVELS)[number];

export type Brief = {
  /** Topic or objective, free text. */
  topic: string;
  durationMin: number;
  classContext?: ClassContext;
  /** How many slides the deck should have; absent on lessons created before the field existed. */
  slideCount?: SlideCount;
  level?: BriefLevel;
  /** Answers to the clarifying questions, keyed by the question id the brief screen chose. */
  answers?: Record<string, string>;
};

export const BriefSchema = z.strictObject({
  topic: guarded(z.string().min(1).max(BRIEF_TOPIC_MAX)),
  durationMin: z.number().int().min(BRIEF_DURATION_MIN).max(BRIEF_DURATION_MAX),
  classContext: ClassContextSchema.optional(),
  slideCount: z.union(SLIDE_COUNTS.map((n) => z.literal(n))).optional(),
  level: z.enum(BRIEF_LEVELS).optional(),
  answers: z
    .record(z.string().min(1).max(64), guarded(z.string().max(BRIEF_ANSWER_MAX)))
    .refine((answers) => Object.keys(answers).length <= MAX_CLARIFYING_QUESTIONS, {
      message: `At most ${MAX_CLARIFYING_QUESTIONS} clarifying questions can be answered.`,
    })
    .optional(),
});
