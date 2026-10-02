import type { FactId } from "@tj/domain/documents";
import type { LessonCycle } from "../worksheet/cycles";
import type { WorksheetFit } from "../worksheet/fit";
import { MAX_EXIT_QUESTIONS } from "../worksheet/lesson-specs";
import { BLOCK_SHAPES } from "./generate-worksheet";
import { HOUSE_RULES } from "./shared";

/*
 * "Follows the lesson" (TEACH-86, rulings 144, 146, 141, 108, 132, 147): one `small` call
 * (gpt-6-luna, effort low) writes the whole sheet from the finished lesson's learning cycles. The
 * output shape is `lessonSheetSchemaFor` (`../worksheet/lesson-specs.ts`); code lays it out ("Task
 * A: <title>", the instruction, the blocks, the exit ticket last), numbers the questions, prints
 * the marks, prefixes "You might have suggested:" / "Mark scheme:" and sizes the writing space.
 *
 * Versions:
 * v1 (2 Oct 2026): draft placeholder (task and shape only) so the code path ran on the fake AI.
 * v2 (2 Oct 2026, prompt-engineer; brief `scratchpad/t86-PROMPT-BRIEF.md`, RESEARCH bar 6–11):
 *   - The task contract in the system text: supported part first (a near-copy of the cycle's
 *     example, then the subject's scaffold), open stretch last; a practise slide's items carried
 *     onto the sheet in the slide's words (bar 9); the misconception confronted with the belief
 *     stated alone and the correction kept for the answer (AUDIT §4: a true/false statement held
 *     its own correction).
 *   - Fit by year band and subject as a short menu of forms (ruling 144, 147: Years 1 to 4 short
 *     items and a word bank), never word counts (ruling 132). Item count is sized by the per-task
 *     minutes code now derives in the user turn (practice minutes ÷ cycles), not by the model.
 *   - Exam-style (ruling 146): the model decides whether the subject is examined with marked
 *     questions; when it is, at least one task's stretch is marked, opens with a command word, and
 *     its answer is one mark-scheme point per mark. Marks live in `marks`, never in the text (the
 *     renderer prints them). Below the exam band the user turn says marks are not used.
 *   - Exit ticket: code states the target count (one per objective, at most 3) in the packet line;
 *     the system text names the line, not a number (gpt-6-luna reads a hedged range as its minimum).
 *   - Misconceptions are sent as belief and correction separately (v1 sent the belief only).
 *   - The block shapes and output sketch moved to the system text, so the user turn is the lesson.
 * v3 (2 Oct 2026, ruling 147): multiple choice takes the class's option count (`fit.optionCount`:
 *   3 for EYFS to Year 4, 4 from Year 5) from a user-turn line; the shape line names that line
 *   instead of "exactly 4" (the shared `BLOCK_SHAPES` still says 4 for the other worksheet calls).
 * v4 (2 Oct 2026, eval of v3 in `quality-prd/activities/T86-EVAL.md`, brief "Eval findings"):
 *   - Every task opens with a scaffold, including a cycle that has only a practise slide; the
 *     practise items follow it (Y1 and Y13 Task C had none, bar 10).
 *   - The answer-key label is no longer quoted: the quoted phrase was copied into answers.
 *   - The exit ticket asks 3 whenever there are fewer objectives: one per objective, then the
 *     misconception or the hardest point (bar 12; Y5 gave 2). Still at most 3 (ruling 108).
 *   - New numbers and cases per item across the sheet (Y5 repeated "3/5 of 35").
 *   - Years 1 to 4: one sentence per item, and a practise item holding several ideas is split
 *     (a 20-word Y1 item copied from the slide).
 *   - A marked item that sets a scenario still opens with its command word (Y11 "A pupil says…").
 * v5 (2 Oct 2026, v4 re-check, same file): the opening scaffold comes from the class's year-band
 *   line (v4's generic list, word bank first, put word banks on the Y13 sheet, against E3);
 *   practise-slide items stay unmarked (a verbatim slide item cannot open with a command word, the
 *   Y11 miss); a Years 1 to 4 slide item asking several things becomes one item per thing; marks
 *   go only in `marks` (Y13 wrote "(3 marks)" in the text).
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

/** Ruling 147: the option count is the class's (the user turn's Multiple choice line), not a fixed 4. */
const MC_SHAPE =
  '{ "type": "multiple-choice", "text", "options": [as many { "text", "correct" } as the Multiple choice line says, exactly one correct], "factRefs" }';

/** Exit questions to ask: three (ruling 108's cap, RESEARCH bar 12's floor), one per objective first. */
export const exitQuestionCount = (): number => MAX_EXIT_QUESTIONS;

export const generateWorksheetLessonPrompt = {
  version: "generate-worksheet-lesson.v5",
  system: [
    "You write the pupil worksheet for a lesson that has just been taught. The user turn gives the class, the lesson's objectives and misconceptions, and its learning cycles: each cycle's teaching slides, then the check and practise slides that followed, as their slide text.",
    "",
    "Tasks:",
    '- One task per cycle, in cycle order; `cycle` is the cycle\'s number. `title` names what the task practises (code adds "Task A:"). `instruction` is one line telling pupils what to do.',
    "- `supported` comes first in every task. It opens with a scaffold from the class's year-band line below, built on the cycle's worked example, check or first practise item; short-answer questions (`answerLines` 1 or 2) may follow.",
    "- `stretch` comes last: at least one open `question` (`answerLines` 3 or more) asking pupils to explain, apply the idea to a new case, or solve a problem.",
    "- Where a cycle has a practise slide, its items go on the sheet in the slide's words, unmarked, after that opening scaffold and in the part they suit (for Years 1 to 4, a slide item asking several things becomes one item per thing), so the teacher can run the sheet from the board. A cycle with only a practise slide still gets its scaffold first. Everything else uses the slides' terms, methods and examples, and asks only what the slides taught.",
    "- Each item on the sheet uses its own numbers, case or example, so no two items ask the same thing.",
    '- Confront the main misconception in at least one task: the belief to judge true or false and justify, "who is right?" between two claims, or a worked answer containing the error to spot and correct. The item states the belief alone; the correction belongs in the answer.',
    "- A multiple-choice item's wrong options are plausible to this class: a misconception, a near-miss term or a slip in the method.",
    "",
    "Fit the class:",
    "- Choose the forms, scaffolds, number of items and reading load for the year group, subject, reading level and class level given. Each task holds what a pupil at this age finishes in the minutes per task the user turn gives.",
    '- Years 1 to 4: items of one short sentence with one idea each; scaffolds are a word bank with gap-fills, matching and multiple choice; the stretch is one short "why" or "what would happen if" question.',
    "- Years 5 to 9: scaffolds are sentence stems, cloze with a word bank, and worked steps to complete; then data written into the item to read, and one extended answer.",
    "- Years 10 to 13: scaffolds are sentence starters, a partly worked step or calculation, or a structure to complete; then multi-step problems, data or source analysis, and extended answers.",
    "- Maths and calculation: fluency items, then a reasoning item, then a word problem. English and humanities: sentence starters, then one extended answer.",
    "",
    "Exam-style items (when the user turn allows them):",
    "- Decide whether this subject is examined at this level with marked written questions. If it is, make the stretch of at least one task a marked question, and others where the exam would ask that way; if it is not, use none.",
    "- A marked question opens with the exam's command word (State, Describe, Explain, Calculate, Compare, Evaluate, Suggest, To what extent …), with any scenario or claim after it (Explain why a pupil who says … is wrong), has 1 to 6 `marks`, and its answer is the mark scheme: one creditworthy point per mark, one per line. The marks go only in `marks`.",
    "",
    "Answers:",
    "- Every item has its full answer for the answer key. An unmarked open question's answer is 2 or 3 model points, one per line, each agreeing with the slides; the answer is the points alone, as code writes the label above them.",
    "",
    "Exit ticket (when the user turn asks for one; otherwise `exitTicket` is null):",
    "- As many items as the exit-ticket line says, spread over the objectives as it says, each a `question` or `multiple-choice` on a key point of this lesson. At least one asks pupils to explain or apply. Each asks in a different way from the slide questions listed.",
    "",
    "Every block:",
    "- The sheet has no pictures: each item is answerable from its own words, with any data, extract or table written into it (a `paragraph` block holds a longer one).",
    "- Code numbers the questions, prints the marks and writes the task headings, so text carries no item number, marks or heading.",
    "- `factRefs` names the objective ids the block practises, plus the misconception id on the block that confronts it.",
    HOUSE_RULES,
    "",
    "Block shapes (exactly these keys):",
    ...Object.entries(BLOCK_SHAPES)
      .filter(([type]) => type !== "heading")
      .map(([type, shape]) => `- ${type}: ${type === "multiple-choice" ? MC_SHAPE : shape}`),
    "",
    "Answer as JSON in this shape:",
    `{"tasks": [${TASK_SHAPE}, …], "exitTicket": [block, …] or null}`,
  ].join("\n"),
  user(input: GenerateWorksheetLessonInput): string {
    const { fit } = input;
    const perTask = Math.max(
      1,
      Math.round(input.practiceMinutes / Math.max(1, input.cycles.length)),
    );
    const parts: string[] = [
      `Lesson: ${input.lessonTitle}`,
      `Year group: ${fit.yearGroup ?? "not given"}; key stage: ${fit.ageBand ?? "not given"}; subject: ${fit.subject ?? "not given"}.`,
    ];
    if (fit.readingLevel) parts.push(`Reading level: ${fit.readingLevel}.`);
    if (fit.level) parts.push(`Class level: ${fit.level}.`);
    parts.push(
      fit.examStyle
        ? "Exam-style marked items: allowed, where this subject is examined that way."
        : "Exam-style marked items: not used for this class; leave `marks` out.",
      `Multiple choice: ${fit.optionCount} options per item.`,
      `Practice time: about ${input.practiceMinutes} minutes, so about ${perTask} minutes per task.`,
      "",
      "Objectives:",
      ...input.objectives.map((o) => `  ${o.id}: ${o.text}`),
    );
    if (input.misconceptions.length > 0) {
      parts.push("Misconceptions:");
      for (const m of input.misconceptions) {
        parts.push(`  ${m.id}: ${m.belief}`);
        if (m.correction.trim()) parts.push(`    Correction: ${m.correction}`);
      }
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
    parts.push("");
    if (input.exitTicket) {
      const n = exitQuestionCount();
      const count = input.objectives.length;
      const which =
        count > n
          ? `one for each of the ${n} objectives that matter most`
          : count === n
            ? "one per objective, in order"
            : "one per objective in order, then the rest on the misconception or the hardest point";
      parts.push(`Exit ticket: yes, ${n} question${n === 1 ? "" : "s"}, ${which}.`);
      if (input.slideStems.length > 0) {
        parts.push(
          "Questions the slides already asked:",
          ...input.slideStems.map((s) => `  - ${s}`),
        );
      }
    } else {
      parts.push("Exit ticket: no (answer null).");
    }
    return parts.join("\n");
  },
} as const;
