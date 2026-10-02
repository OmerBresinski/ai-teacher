import type { Finding, Lesson, Worksheet, WorksheetBlock } from "@tj/domain/documents";
import {
  answerLinesForMarks,
  type BlockSpec,
  docFromText,
  type MaterialiseMeta,
  materialiseBlock,
  numberQuestions,
} from "@tj/slides";
import { callStructured, specRuleFinding } from "../call";
import { generateWorksheetLessonPrompt } from "../prompts";
import { lessonCycles, lessonPointsToExitTicket, slideQuestionStems } from "./cycles";
import type { FillDeps, FillResult } from "./fill";
import { withInstructions } from "./fill";
import { worksheetFit } from "./fit";
import {
  answerPoints,
  type LessonSheetOutput,
  lessonSheetSchemaFor,
  OPEN_ANSWER_LINES,
} from "./lesson-specs";

/*
 * "Follows the lesson" (TEACH-86, ruling 144): the frame is one placeholder; this one `small`
 * call reads the finished lesson's learning cycles (`lessonCycles`) and the pupils it is for
 * (`worksheetFit`) and writes the whole sheet. Code then lays it out: "Task A: …" per cycle, the
 * task's instruction line, the supported blocks, the stretch blocks; the exit ticket last when it
 * was asked for (ruling 141). An open answer's model points become one answer-key line each under
 * "You might have suggested:" (a marked one under "Mark scheme:"), its writing space is sized to
 * the points and marks, and marks are dropped below KS4 (ruling 146). `showMarks` is set when any
 * marked item stands.
 */

export interface LessonSheetInput {
  worksheet: Worksheet;
  lesson: Lesson;
  practiceMinutes: number;
  /**
   * The teacher's exit-ticket choice (ruling 141): `true` or `false` when they made one, which
   * always wins. `undefined` means no choice yet, and the sheet keeps today's default: an exit
   * ticket when the slides point the class to one. TEACH-22 (the remembered per-teacher
   * preference) supplies this value once it lands; nothing here infers it.
   */
  exitTicket?: boolean;
}

/**
 * The output cap grows with the sheet: a low-effort reasoning preamble, then one task (its blocks
 * and their answers) per cycle, plus the exit ticket. Never the reason a long lesson's sheet fails.
 */
export const LESSON_SHEET_TOKENS = { base: 2500, perCycle: 1500, exitTicket: 1000, max: 16000 };

export function lessonSheetOutputTokens(cycles: number, exitTicket: boolean): number {
  const { base, perCycle, exitTicket: exit, max } = LESSON_SHEET_TOKENS;
  return Math.min(max, base + perCycle * Math.max(1, cycles) + (exitTicket ? exit : 0));
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const taskLabel = (i: number) => LETTERS[i] ?? String(i + 1);

/** Writing space sized to the demand: two lines a point, the marks' lines, never under the ask. */
export function answerLinesFor(spec: BlockSpec & { type: "question" }): number {
  const points = spec.answerLines >= OPEN_ANSWER_LINES ? answerPoints(spec.answer).length : 0;
  const byMarks = spec.marks !== undefined ? answerLinesForMarks(spec.marks) : 0;
  return Math.min(6, Math.max(spec.answerLines, points * 2, byMarks));
}

/** The answer-key text: closed answers as written; open ones as model points, one per line. */
export function answerText(spec: BlockSpec & { type: "question" }): string {
  if (spec.answerLines < OPEN_ANSWER_LINES) return spec.answer;
  const points = answerPoints(spec.answer);
  if (points.length < 2) return spec.answer;
  const lead = spec.marks !== undefined ? "Mark scheme:" : "You might have suggested:";
  return [lead, ...points.map((p) => `- ${p}`)].join("\n");
}

function toBlock(
  spec: BlockSpec,
  meta: MaterialiseMeta,
  deps: Pick<FillDeps, "ids">,
  examStyle: boolean,
): WorksheetBlock {
  if (spec.type !== "question") return materialiseBlock(spec, meta, deps.ids);
  const { marks, ...rest } = spec;
  const kept = examStyle && marks !== undefined ? { ...rest, marks } : rest;
  const block = materialiseBlock(kept, meta, deps.ids);
  if (block.type !== "question") return block;
  return { ...block, answer: answerText(kept), answerLines: answerLinesFor(kept) };
}

const textBlock = (
  type: "heading" | "instructions",
  text: string,
  meta: MaterialiseMeta,
  deps: Pick<FillDeps, "ids">,
  refs: string[],
): WorksheetBlock => ({
  id: deps.ids(),
  ...(type === "heading"
    ? { type, doc: docFromText(text), level: 2 as const }
    : { type, doc: docFromText(text) }),
  generatedFrom: {
    factRefs: refs,
    promptVersion: meta.promptVersion,
    model: meta.model,
    at: meta.at,
  },
  authoredBy: "ai",
});

/** The sheet's blocks from the call's answer: tasks in cycle order, then the exit ticket. */
export function layOutLessonSheet(
  output: LessonSheetOutput,
  meta: MaterialiseMeta,
  deps: Pick<FillDeps, "ids">,
  options: { examStyle: boolean; objectiveRefs: (cycle: number) => string[] },
): WorksheetBlock[] {
  const blocks: WorksheetBlock[] = [];
  output.tasks.forEach((task, i) => {
    const refs = options.objectiveRefs(task.cycle);
    blocks.push(textBlock("heading", `Task ${taskLabel(i)}: ${task.title}`, meta, deps, refs));
    blocks.push(textBlock("instructions", task.instruction, meta, deps, refs));
    for (const spec of [...task.supported, ...task.stretch]) {
      blocks.push(toBlock(spec, meta, deps, options.examStyle));
    }
  });
  if (output.exitTicket && output.exitTicket.length > 0) {
    const refs = Array.from(new Set(output.exitTicket.flatMap((b) => b.factRefs)));
    blocks.push(textBlock("heading", "Exit ticket", meta, deps, refs));
    blocks.push(
      textBlock("instructions", "Answer on your own, then hand this in.", meta, deps, refs),
    );
    for (const spec of output.exitTicket) blocks.push(toBlock(spec, meta, deps, options.examStyle));
  }
  return numberQuestions(withInstructions(blocks));
}

export async function fillLessonSheet(
  input: LessonSheetInput,
  deps: FillDeps,
): Promise<FillResult> {
  const { worksheet, lesson, practiceMinutes } = input;
  const facts = lesson.facts;
  const cycles = lessonCycles(lesson);
  const fit = worksheetFit(lesson);
  const exitTicket = input.exitTicket ?? lessonPointsToExitTicket(lesson);
  const slideStems = exitTicket ? slideQuestionStems(lesson, cycles) : [];
  const context = {
    cycles: cycles.length,
    examStyle: fit.examStyle,
    exitTicket,
    slideStems,
    optionCount: fit.optionCount,
    practiceMinutes,
  };
  const call = await callStructured({
    deps,
    stage: "worksheet",
    cls: "small",
    effort: "low",
    prompt: generateWorksheetLessonPrompt,
    input: {
      lessonTitle: lesson.title,
      fit,
      objectives: (facts?.objectives ?? []).map(({ id, text }) => ({ id, text })),
      misconceptions: (facts?.misconceptions ?? []).map(({ id, belief, correction }) => ({
        id,
        belief,
        correction,
      })),
      cycles,
      exitTicket,
      slideStems,
      practiceMinutes,
    },
    schema: lessonSheetSchemaFor(context),
    soft: lessonSheetSchemaFor(context, { soft: true }),
    maxOutputTokens: lessonSheetOutputTokens(cycles.length, exitTicket),
  });
  const meta: MaterialiseMeta = {
    promptVersion: generateWorksheetLessonPrompt.version,
    model: call.modelId,
    at: deps.now().toISOString(),
  };
  const blocks = layOutLessonSheet(call.output, meta, deps, {
    examStyle: fit.examStyle,
    objectiveRefs: (cycle) => cycles[cycle - 1]?.objectiveIds ?? [],
  });
  const findings: Finding[] = call.editorialMisses.map((miss) =>
    specRuleFinding(miss, {}, "warning"),
  );
  const marked = blocks.some((b) => b.type === "question" && b.marks !== undefined);
  deps.logger.info(
    {
      recipeId: "lesson",
      cycles: cycles.length,
      tasks: call.output.tasks.length,
      exitTicket: exitTicket ? (call.output.exitTicket?.length ?? 0) : 0,
      blocks: blocks.length,
      examStyle: fit.examStyle,
      marked,
      attempts: call.attempts,
      editorialMisses: call.editorialMisses.length,
    },
    "worksheet lesson sheet answered",
  );
  const { showMarks: _off, ...rest } = worksheet;
  return {
    worksheet: { ...rest, blocks, ...(marked ? { showMarks: true } : {}) },
    findings,
    reservedStems: slideStems,
    modelId: call.modelId,
    promptVersion: generateWorksheetLessonPrompt.version,
  };
}
