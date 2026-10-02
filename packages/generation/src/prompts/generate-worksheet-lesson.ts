import type { FactId } from "@tj/domain/documents";
import type { LessonCycle } from "../worksheet/cycles";
import type { WorksheetFit } from "../worksheet/fit";
import { BLOCK_SHAPES } from "./generate-worksheet";
import { HOUSE_RULES } from "./shared";

/*
 * "Follows the lesson" (TEACH-86, rulings 144, 146, 141, 108): one `small` call writes the whole
 * sheet from the finished lesson's learning cycles. The output shape is `lessonSheetSchemaFor`
 * (`../worksheet/lesson-specs.ts`).
 *
 * DRAFT: the system text below is a placeholder that states only the task and the shape, so the
 * code path runs end to end on the fake AI. The real wording is the prompt-engineer's, from the
 * brief in `scratchpad/t86-PROMPT-BRIEF.md`; it replaces `system` (and may reword `user`), bumps
 * `version` and re-pins the hash in `prompts.test.ts`. Do not ship this version to production.
 */

export type GenerateWorksheetLessonInput = {
  lessonTitle: string;
  fit: WorksheetFit;
  objectives: { id: FactId; text: string }[];
  misconceptions: { id: FactId; belief: string; correction: string }[];
  cycles: LessonCycle[];
  exitTicket: boolean;
  /** What the slides already asked, which the exit ticket must not repeat word for word. */
  slideStems: string[];
  practiceMinutes: number;
};

const TASK_SHAPE =
  '{"cycle": 1, "title": "…", "instruction": "…", "supported": [block, …], "stretch": [block, …]}';

export const generateWorksheetLessonPrompt = {
  version: "generate-worksheet-lesson.v1",
  system: [
    "You write a pupil worksheet that follows a finished lesson: one task for each learning cycle, in order, each a supported part then a stretch, with a full answer for every item.",
    "",
    HOUSE_RULES,
    "",
    "Answer as JSON in this shape:",
    `{"tasks": [${TASK_SHAPE}, …], "exitTicket": [block, …] or null}`,
  ].join("\n"),
  user(input: GenerateWorksheetLessonInput): string {
    const { fit } = input;
    const parts: string[] = [
      `Lesson: ${input.lessonTitle}`,
      `Year group: ${fit.yearGroup ?? "not given"}; key stage: ${fit.ageBand ?? "not given"}; subject: ${fit.subject ?? "not given"}.`,
    ];
    if (fit.readingLevel) parts.push(`Reading level: ${fit.readingLevel}.`);
    if (fit.level) parts.push(`Class level: ${fit.level}.`);
    parts.push(
      `Exam-style marked items: ${fit.examStyle ? "allowed where the subject is examined that way" : "none"}.`,
      `Practice time: about ${input.practiceMinutes} minutes.`,
      "",
      "Objectives:",
      ...input.objectives.map((o) => `  ${o.id}: ${o.text}`),
    );
    if (input.misconceptions.length > 0) {
      parts.push("Misconceptions:", ...input.misconceptions.map((m) => `  ${m.id}: ${m.belief}`));
    }
    parts.push("", `Learning cycles (${input.cycles.length}):`);
    for (const cycle of input.cycles) {
      parts.push(
        `Cycle ${cycle.index}: ${cycle.title} (objectives: ${cycle.objectiveIds.join(", ") || "none named"})`,
      );
      for (const slide of cycle.slides) {
        parts.push(`  [${slide.part}]`, ...slide.text.split("\n").map((line) => `    ${line}`));
      }
    }
    parts.push(
      "",
      input.exitTicket
        ? "Exit ticket: yes, 1 to 3 questions, one per objective first."
        : "Exit ticket: no (answer null).",
    );
    if (input.exitTicket && input.slideStems.length > 0) {
      parts.push("Questions the slides already asked:", ...input.slideStems.map((s) => `  - ${s}`));
    }
    parts.push("", "Block shapes:");
    for (const [type, shape] of Object.entries(BLOCK_SHAPES)) parts.push(`- ${type}: ${shape}`);
    parts.push("", "Answer with the worksheet JSON.");
    return parts.join("\n");
  },
} as const;
