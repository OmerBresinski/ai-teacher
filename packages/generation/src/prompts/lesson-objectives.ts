import { z } from "zod";
import { type Audience, audienceBlock } from "./shared";

/*
 * lab/t3: the objectives call T3 writes from (5 Oct 2026, round T3-CAND/OBJECTIVES). It replaces
 * `plan-objectives` on the T3 path only; the designer and the old planner keep that prompt.
 *
 * Why: T3 beat R3 13-4-4 on R3's own objectives and fell to 8-2-7 on plan-objectives.v25's
 * (`T3-CAND/content-panel/RESULT.md`). v25 told the call "the lesson's verb is its reach" and the
 * brief's default verb is Explain, so every objective began "Explain how"; and it named no
 * year-group content, so the improper fractions, the Dawes Plan, the named animals, the change in
 * shape and the energy transfer R3 wrote were dropped. Every T3C loss tracked one of them.
 *
 * T3 reads only the objectives' text, so this call asks for nothing else (no arcs, retrieval or
 * bookends) and sees the brief exactly as T3's writer does (`lessonContext`). Each sentence and
 * the evidence for it is in the clause ledger, `quality-prd/lab/rounds/ABLATE/T3-LEDGER.md`
 * ("Objectives call"). No word limit (Greg): the schema bounds only the count.
 */

export type LessonObjectivesInput = {
  topic: string;
  audience: Audience;
  /** The brief's answers, as T3's context renders them. */
  answers?: Record<string, string> | undefined;
  slideCount: number;
};

/** The brief as T3's writer sees it (`plan-write/simple.ts`): topic, audience, the answers. */
export function lessonContext(i: Omit<LessonObjectivesInput, "slideCount">): string {
  const answers = i.answers ? Object.entries(i.answers).map(([k, v]) => `${k}: ${v}`) : [];
  return [
    `Topic: ${i.topic}`,
    audienceBlock(i.audience),
    ...(answers.length > 0 ? ["The teacher's answers:", ...answers] : []),
  ].join("\n");
}

/**
 * The count, from the slide count (code does the arithmetic). Slides 3 to N hold a teach and a
 * check per objective plus closing practice and the exit ticket (`t3Room`): 6 slides hold two,
 * 10 hold three (R3 wrote 2-3 at 10 and won with them), 12 or more hold four.
 */
export function objectiveCount(slideCount: number): string {
  if (slideCount <= 7) return "one or two";
  if (slideCount <= 11) return "two or three";
  return "three or four";
}

export const LessonObjectivesOutputSchema = z.object({
  objectives: z.array(z.string().min(8)).min(1).max(4),
});
export type LessonObjectivesOutput = z.output<typeof LessonObjectivesOutputSchema>;

export const lessonObjectivesPrompt = {
  version: "lesson-objectives.v1",
  system: "You're an expert teacher in England and head of department for this subject.",
  user(i: LessonObjectivesInput): string {
    const n = i.slideCount;
    return [
      lessonContext(i),
      "",
      `Write the learning objectives for this one ${n}-slide lesson, as a head of department writes them for a colleague to teach from: ${objectiveCount(n)}.`,
      "Together they cover what a lesson on this topic teaches this year group in England.",
      "Each names its content: the cases, methods, terms, events or texts pupils learn, not a heading that stands for them.",
      "Each starts with the command word for what pupils do with that content, as this subject uses it at this age.",
      "",
      'JSON: { "objectives": ["...", "..."] }',
    ].join("\n");
  },
} as const;
