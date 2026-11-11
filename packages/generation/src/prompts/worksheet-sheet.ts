import { yearNumberOf } from "@tj/domain/documents";
import type { LessonDigest } from "@tj/slides/worksheet/digest";
import type { StructuredPrompt } from "../call";
import {
  EXAM_SYSTEM,
  NOTATION_KS1,
  NOTATION_KS2,
  NOTATION_KS3_4,
  PRACTICE_BAND_Y1_2,
  PRACTICE_BAND_Y3_9,
  PRACTICE_BAND_Y10_11,
  PRACTICE_SYSTEM,
} from "./worksheet-sheet-text";

/*
 * The Practice and Exam practice writer prompts (worksheets plan v2 T7). The text is the prompt
 * engineer's (`worksheet-sheet-text.ts`, byte-for-byte); this module only assembles it as
 * `user.template.txt` says: system = type + (Practice) band + notation, joined with "\n"; the user
 * turn is the digest rendered into the template's headed blocks, then the SHEET block, whose
 * numbers code computes.
 */

export type SheetBand = "y1-2" | "y3-9" | "y10-11";
export type SheetKeyStage = "ks1" | "ks2" | "ks3-4";

/** Year 1-2 → y1-2; 3-9 → y3-9; 10 and up → y10-11. A year group with no number reads as 3-9. */
export function bandOf(yearGroup: string): SheetBand {
  const year = yearNumberOf(yearGroup);
  if (year === undefined) return /reception|eyfs|nursery/i.test(yearGroup) ? "y1-2" : "y3-9";
  return year <= 2 ? "y1-2" : year <= 9 ? "y3-9" : "y10-11";
}

/** Year 1-2 → ks1; 3-6 → ks2; 7 and up → ks3-4. */
export function keyStageOf(yearGroup: string): SheetKeyStage {
  const year = yearNumberOf(yearGroup);
  if (year === undefined) return /reception|eyfs|nursery/i.test(yearGroup) ? "ks1" : "ks3-4";
  return year <= 2 ? "ks1" : year <= 6 ? "ks2" : "ks3-4";
}

const BAND_TEXT: Record<SheetBand, string> = {
  "y1-2": PRACTICE_BAND_Y1_2,
  "y3-9": PRACTICE_BAND_Y3_9,
  "y10-11": PRACTICE_BAND_Y10_11,
};
const NOTATION_TEXT: Record<SheetKeyStage, string> = {
  ks1: NOTATION_KS1,
  ks2: NOTATION_KS2,
  "ks3-4": NOTATION_KS3_4,
};

const KIND_WORD = { mc: "multiple choice", practice: "practice", exit: "exit ticket" } as const;

/** The digest as the template's headed blocks; an empty block is left out whole. */
export function digestBrief(digest: LessonDigest, options: { mistakes: boolean }): string {
  const l = digest.lesson;
  const blocks: string[] = [];
  blocks.push(
    [
      "THE CLASS",
      `Subject: ${l.subject}`,
      `Year group: ${l.yearGroup}${l.keyStage ? ` (${l.keyStage})` : ""}`,
      `Reading level: ${l.readingLevel}`,
      ...(l.historicalPeriod ? [`Historical period: ${l.historicalPeriod}`] : []),
      `Lesson title: ${l.title}`,
    ].join("\n"),
  );
  if (digest.objectives.length > 0) {
    blocks.push(["OBJECTIVES", ...digest.objectives.map((o, i) => `${i + 1}. ${o}`)].join("\n"));
  }
  if (digest.taught.length > 0) {
    const slides = digest.taught.map((t) =>
      [
        `Slide ${t.slide}: ${t.heading}`,
        ...(t.text ? [`  ${t.text.split("\n").join("\n    ")}`] : []),
        ...(t.namedItems ?? []).map((item) => `  - ${item.name}: ${item.meaning}`),
        ...(t.worked ?? []).map((step, i) => `  Step ${i + 1}. ${step}`),
      ].join("\n"),
    );
    blocks.push(`TAUGHT SLIDES\n${slides.join("\n\n")}`);
  }
  if (digest.asked.length > 0) {
    const asked = digest.asked.map((a) => {
      const wrong = (a.options ?? []).filter((o) => o !== a.answer);
      return [
        `Slide ${a.slide}, ${KIND_WORD[a.kind]}: ${a.question}`,
        `  Answer: ${a.answer}${a.working ? ` (working: ${a.working})` : ""}`,
        ...(wrong.length > 0 ? [`  Wrong options: ${wrong.join(" | ")}`] : []),
      ].join("\n");
    });
    blocks.push(
      [
        "ALREADY ASKED IN THE LESSON (answers are true facts of the lesson; never repeat or reword these questions)",
        ...asked,
      ].join("\n"),
    );
  }
  if (options.mistakes && digest.misconceptions?.length) {
    blocks.push(
      [
        "COMMON MISTAKES (wrong ideas pupils may hold; not a source of facts)",
        ...digest.misconceptions.map((m, i) => `M${i + 1}. ${m}`),
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

export type PracticeCounts = { warmUp: number; core: number; total: number };

/** D9: Years 1-2 4-6 items, Years 3-11 6-10; 10 minutes or less → low end, 20 or more → high. */
export function practiceCounts(yearGroup: string, practiceMinutes: number): PracticeCounts {
  const [low, high] = bandOf(yearGroup) === "y1-2" ? [4, 6] : [6, 10];
  const t = Math.min(1, Math.max(0, (practiceMinutes - 10) / 10));
  const total = Math.round(low + t * (high - low));
  return { warmUp: 2, core: total - 3, total };
}

const LEVEL_LINE = {
  standard: "as the lesson.",
  easier: "easier: keep core items to one step and the challenge to two.",
  harder: "harder: core items at the harder end of the lesson's questions.",
} as const;

export type PracticeInput = { digest: LessonDigest; counts: PracticeCounts };

export function practicePrompt(yearGroup: string): StructuredPrompt<PracticeInput> {
  return {
    version: "worksheet-practice.v2",
    system: [
      PRACTICE_SYSTEM,
      BAND_TEXT[bandOf(yearGroup)],
      NOTATION_TEXT[keyStageOf(yearGroup)],
    ].join("\n"),
    user: ({ digest, counts }) =>
      [
        digestBrief(digest, { mistakes: true }),
        [
          "SHEET",
          `Write exactly ${counts.warmUp} warm-up items, ${counts.core} core items and 1 challenge.`,
          `Challenge level: ${LEVEL_LINE[digest.lesson.level]}`,
        ].join("\n"),
      ].join("\n\n"),
  };
}

/** Code plans the marks (schemas.md): 1,1,2,2,3,3,4 (16); a lesson with fewer than 4 taught slides 1-5 (15). */
export function examMarksPlan(digest: LessonDigest): number[] {
  return digest.taught.length < 4 ? [1, 2, 3, 4, 5] : [1, 1, 2, 2, 3, 3, 4];
}

export type ExamInput = { digest: LessonDigest; marks: number[] };

export function examPrompt(yearGroup: string): StructuredPrompt<ExamInput> {
  return {
    version: "worksheet-exam.v1",
    system: [EXAM_SYSTEM, NOTATION_TEXT[keyStageOf(yearGroup)]].join("\n"),
    user: ({ digest, marks }) =>
      [
        digestBrief(digest, { mistakes: true }),
        [
          "SHEET",
          `Write exactly ${marks.length} questions with these marks, in order: ${marks.join(", ")} (${marks.reduce((a, b) => a + b, 0)} marks in all).`,
        ].join("\n"),
      ].join("\n\n"),
  };
}
