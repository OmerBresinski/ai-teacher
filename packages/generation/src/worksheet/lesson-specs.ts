import type { BlockSpec } from "@tj/slides";
import {
  editorialIssue,
  lessonSheetBlockUnion,
  MINUTE_WEIGHTS,
  noPictureReference,
  type SpecSchemaOptions,
  shapeIssue,
} from "@tj/slides";
import { z } from "zod";
import { normaliseStem } from "./cycles";

/*
 * What the "Follows the lesson" call returns (TEACH-86; brief `scratchpad/t86-PROMPT-BRIEF.md`).
 * One task per learning cycle, in lesson order, each a supported part then a stretch part, plus
 * the exit ticket when one was asked for (rulings 141, 108). Blocks are the writable block specs
 * (`blockSpecUnion`). Shape rules fail the call after its one retry: tasks out of order or naming
 * a cycle the lesson has not got, an exit ticket that was not asked for (or missing, or over
 * three items). The pedagogy rules are editorial (TEACH-257), accepted on the retry and recorded
 * as findings: every cycle has a task, the supported part opens with a closed or short form, the
 * stretch has an open question, an open question's answer is 2 or 3 model points, marks only
 * where exam-style items are allowed and each marked item opens with a command word, and no exit
 * question repeats a slide question word for word.
 */

/** Block types the exit ticket may use: quick to mark. */
export const EXIT_TICKET_TYPES = ["question", "multiple-choice"] as const;
/** Ruling 108: an exit ticket holds at most three questions. */
export const MAX_EXIT_QUESTIONS = 3;
/** A question with this many answer lines or more is open: its answer is model points. */
export const OPEN_ANSWER_LINES = 3;

/** Exam command words (AQA, Edexcel, OCR glossaries), as a marked item opens with them. */
export const COMMAND_WORDS = [
  "analyse",
  "assess",
  "calculate",
  "compare",
  "complete",
  "define",
  "describe",
  "determine",
  "discuss",
  "draw",
  "estimate",
  "evaluate",
  "examine",
  "explain",
  "give",
  "how far",
  "identify",
  "interpret",
  "justify",
  "label",
  "name",
  "outline",
  "plot",
  "predict",
  "show",
  "sketch",
  "state",
  "suggest",
  "summarise",
  "to what extent",
  "use",
  "write",
] as const;

const SUPPORTED_TYPES: ReadonlySet<string> = new Set([
  "fill-gap",
  "word-bank",
  "multiple-choice",
  "matching",
]);

/**
 * A list marker the model copied from a slide ("1:", "2)", "3.", "•", "-"). The renderer draws the
 * one marker an item gets (one marker per item), so the item's own text starts after it.
 */
const LIST_MARKER = /^\s*(?:\d{1,2}\s*[:.)]|[•\-–*])\s+/;

export const stripListMarker = (text: string): string => {
  const stripped = text.replace(LIST_MARKER, "");
  return stripped.trim().length > 0 ? stripped : text;
};

/** Every item's text without a copied marker, before any rule reads it. */
function withoutListMarkers(sheet: LessonSheetOutput): LessonSheetOutput {
  const clean = <B>(block: B): B =>
    block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
      ? { ...block, text: stripListMarker((block as unknown as { text: string }).text) }
      : block;
  return {
    ...sheet,
    tasks: sheet.tasks.map((t) => ({
      ...t,
      supported: t.supported.map(clean),
      stretch: t.stretch.map(clean),
    })),
    exitTicket: sheet.exitTicket === null ? null : sheet.exitTicket.map(clean),
  };
}

const words = (text: string): string[] =>
  stripListMarker(text)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(" ")
    .filter(Boolean);

/**
 * True when two items ask the same thing: the same words, or (for items of 4 words or more) at
 * least 80% of their distinct words shared (Jaccard). Numbers count as words, so "3/5 of 35" and
 * "3/5 of 40" differ.
 */
export function nearDuplicate(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.length === 0 || y.length === 0) return false;
  if (x.join(" ") === y.join(" ")) return true;
  if (Math.min(x.length, y.length) < 4) return false;
  const sx = new Set(x);
  const sy = new Set(y);
  const shared = [...sx].filter((w) => sy.has(w)).length;
  return shared / (sx.size + sy.size - shared) >= 0.8;
}

function shape(soft: boolean) {
  const text = z.string().trim().min(1);
  return z.strictObject({
    tasks: z
      .array(
        z.strictObject({
          cycle: z.number().int().min(1),
          title: text,
          instruction: text,
          supported: z.array(lessonSheetBlockUnion({ soft })).min(1),
          stretch: z.array(lessonSheetBlockUnion({ soft })).min(1),
        }),
      )
      .min(1),
    exitTicket: z.array(lessonSheetBlockUnion({ soft })).nullable(),
  });
}
export type LessonSheetOutput = z.infer<ReturnType<typeof shape>>;
export type LessonSheetTask = LessonSheetOutput["tasks"][number];

export type LessonSheetContext = {
  /** How many learning cycles the lesson has (`lessonCycles`). */
  cycles: number;
  examStyle: boolean;
  exitTicket: boolean;
  /** Normalised stems the slides already asked (`slideQuestionStems`). */
  slideStems: readonly string[];
  /** Options on a multiple-choice item (ruling 147, `optionCountFor`); 4 when unset. */
  optionCount?: 3 | 4;
  /** The sheet's practice time; when set, tasks well short of it are an editorial miss. */
  practiceMinutes?: number;
};

/**
 * Minutes a pupil spends on one task block, for sizing the tasks against the practice time
 * (TEACH-86 v6 eval: a 20-minute Year 5 sheet held about 5). The marked, gap, multiple-choice and
 * matching rates are `MINUTE_WEIGHTS`, as the sheet header counts them; an unmarked question,
 * which the header does not count, is a minute when short and three when open. The prompt's
 * Practice time line states these same rates (`practiceTimeLine`).
 */
export const OPEN_QUESTION_MINUTES = 3;
export function specMinutes(block: BlockSpec): number {
  switch (block.type) {
    case "question":
      if (block.marks !== undefined) return block.marks * MINUTE_WEIGHTS.perMark;
      return block.answerLines >= OPEN_ANSWER_LINES ? OPEN_QUESTION_MINUTES : 1;
    case "multiple-choice":
      return MINUTE_WEIGHTS.multipleChoice;
    case "fill-gap":
      return block.answers.length * MINUTE_WEIGHTS.perGap;
    case "matching":
      return MINUTE_WEIGHTS.matching;
    default:
      return 0;
  }
}
/** Tasks under this share of the practice time are a miss (the job's practice-time tolerance is 30 %). */
export const TASK_MINUTES_FLOOR_PERCENT = 70;

/** The model points of an open answer: one per non-empty line. */
/** A label line the model sometimes writes itself; code adds the label, so it is not a point. */
const ANSWER_LABEL =
  /^(?:you might have suggested|mark scheme|model answer|possible answers?)\s*:?$/i;

export const answerPoints = (answer: string): string[] =>
  answer
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim())
    .filter((line) => line && !ANSWER_LABEL.test(line));

const opensWithCommandWord = (text: string): boolean => {
  const lower = text.trim().toLowerCase();
  return COMMAND_WORDS.some((word) => lower.startsWith(word));
};

/** True for a block that is a supported (closed or short) form. */
export function isSupportedForm(block: BlockSpec): boolean {
  if (SUPPORTED_TYPES.has(block.type)) return true;
  return block.type === "question" && block.answerLines < OPEN_ANSWER_LINES;
}

/**
 * How many points an open answer needs: 2–3 model points; a marked item's mark scheme is one
 * point per mark, so a 1-mark item may have one.
 */
export function pointsRange(block: BlockSpec & { type: "question" }): [number, number] {
  if (block.marks === undefined) return [2, 3];
  return [Math.min(2, block.marks), Math.max(3, block.marks)];
}

/** FR 3: a marked item that opens with a command word and carries a mark scheme. */
export function isExamItem(block: BlockSpec): boolean {
  return (
    block.type === "question" &&
    block.marks !== undefined &&
    opensWithCommandWord(block.text) &&
    answerPoints(block.answer).length >= 1
  );
}

export function lessonSheetSchemaFor(
  context: LessonSheetContext,
  options: SpecSchemaOptions = {},
): z.ZodType<LessonSheetOutput> {
  const soft = options.soft === true;
  const slideStems = new Set(context.slideStems);
  const optionCount = context.optionCount ?? 4;
  return shape(soft)
    .overwrite(withoutListMarkers)
    .superRefine((sheet, ctx) => {
      let last = 0;
      const covered = new Set<number>();
      const each = (block: BlockSpec, path: (string | number)[]) => {
        if (block.type === "multiple-choice" && block.options.length !== optionCount) {
          ctx.addIssue(
            editorialIssue(
              `A multiple-choice item for this class has ${optionCount} options, not ${block.options.length}.`,
              [...path, "options"],
            ),
          );
        }
        if (block.type === "question") {
          if (block.marks !== undefined && !context.examStyle) {
            ctx.addIssue(
              editorialIssue(
                "Marks belong to exam-style items, which this year group does not get; leave `marks` out.",
                [...path, "marks"],
              ),
            );
          }
          if (block.marks !== undefined && context.examStyle && !opensWithCommandWord(block.text)) {
            ctx.addIssue(
              editorialIssue(
                `A marked item opens with an exam command word (${COMMAND_WORDS.slice(0, 6).join(", ")} …).`,
                [...path, "text"],
              ),
            );
          }
          if (block.answerLines >= OPEN_ANSWER_LINES) {
            const [low, high] = pointsRange(block);
            const n = answerPoints(block.answer).length;
            if (n < low || n > high) {
              ctx.addIssue(
                editorialIssue(
                  `An open question's answer is ${low} to ${high} model points, one per line; this one has ${n}.`,
                  [...path, "answer"],
                ),
              );
            }
          }
        }
        noPictureReference(block, {
          addIssue: (issue: { path?: PropertyKey[] }) =>
            ctx.addIssue({ ...issue, path: [...path, ...(issue.path ?? [])] } as never),
        } as unknown as z.RefinementCtx);
      };
      sheet.tasks.forEach((task, i) => {
        if (task.cycle > context.cycles) {
          ctx.addIssue(
            shapeIssue(
              `There is no cycle ${task.cycle}; the lesson has ${context.cycles}.`,
              ["tasks", i, "cycle"],
              "unknown cycle",
            ),
          );
        } else if (task.cycle <= last) {
          ctx.addIssue(
            shapeIssue(
              `Task ${i + 1} follows cycle ${task.cycle} after cycle ${last}; one task per cycle, in lesson order.`,
              ["tasks", i, "cycle"],
              "cycle order",
            ),
          );
        }
        last = Math.max(last, task.cycle);
        covered.add(task.cycle);
        if (soft) return;
        if (!task.supported.some(isSupportedForm)) {
          ctx.addIssue(
            editorialIssue(
              "The supported part needs a closed or short form (fill-gap, word bank, multiple choice, matching, or a short-answer question).",
              ["tasks", i, "supported"],
            ),
          );
        }
        if (!task.stretch.some((b) => b.type === "question")) {
          ctx.addIssue(
            editorialIssue("The stretch needs an open question (explain, apply, a problem).", [
              "tasks",
              i,
              "stretch",
            ]),
          );
        }
        task.supported.forEach((b, j) => {
          each(b, ["tasks", i, "supported", j]);
        });
        task.stretch.forEach((b, j) => {
          each(b, ["tasks", i, "stretch", j]);
        });
      });
      if (context.exitTicket) {
        const exit = sheet.exitTicket;
        if (exit === null || exit.length === 0 || exit.length > MAX_EXIT_QUESTIONS) {
          ctx.addIssue(
            shapeIssue(
              `The exit ticket holds 1 to ${MAX_EXIT_QUESTIONS} questions.`,
              ["exitTicket"],
              "exit ticket count",
            ),
          );
        } else {
          exit.forEach((block, j) => {
            if (!(EXIT_TICKET_TYPES as readonly string[]).includes(block.type)) {
              ctx.addIssue(
                shapeIssue(
                  `An exit-ticket item is a question or multiple choice, not "${block.type}".`,
                  ["exitTicket", j, "type"],
                  "exit ticket type",
                ),
              );
              return;
            }
            if (soft) return;
            const stem = "text" in block ? normaliseStem(block.text) : "";
            if (slideStems.has(stem)) {
              ctx.addIssue(
                editorialIssue(
                  "This exit question repeats a slide question word for word; ask it a new way.",
                  ["exitTicket", j, "text"],
                ),
              );
            }
            each(block, ["exitTicket", j]);
          });
        }
      } else if (sheet.exitTicket !== null && sheet.exitTicket.length > 0) {
        ctx.addIssue(
          shapeIssue(
            "No exit ticket was asked for; answer null.",
            ["exitTicket"],
            "exit ticket unasked",
          ),
        );
      }
      if (soft) return;
      if (context.practiceMinutes !== undefined) {
        const minutes = Math.round(
          sheet.tasks.reduce(
            (sum, t) =>
              sum + [...t.supported, ...t.stretch].reduce((m, b) => m + specMinutes(b), 0),
            0,
          ),
        );
        if (minutes * 100 < context.practiceMinutes * TASK_MINUTES_FLOOR_PERCENT) {
          ctx.addIssue(
            editorialIssue(
              `The tasks hold about ${minutes} minutes of work for a ${context.practiceMinutes}-minute sheet; add closed items (calculate, fill the gap, match, choose) to the supported parts until they fill it.`,
              ["tasks"],
            ),
          );
        }
      }
      const items: { text: string; path: (string | number)[] }[] = [];
      sheet.tasks.forEach((task, i) => {
        for (const part of ["supported", "stretch"] as const) {
          task[part].forEach((b, j) => {
            if ("text" in b && typeof b.text === "string")
              items.push({ text: b.text, path: ["tasks", i, part, j, "text"] });
          });
        }
      });
      (sheet.exitTicket ?? []).forEach((b, j) => {
        if ("text" in b && typeof b.text === "string")
          items.push({ text: b.text, path: ["exitTicket", j, "text"] });
      });
      items.forEach((item, k) => {
        const earlier = items.slice(0, k).find((e) => nearDuplicate(e.text, item.text));
        if (earlier) {
          ctx.addIssue(
            editorialIssue(
              `This item repeats an earlier one ("${earlier.text.slice(0, 60)}"); ask something new.`,
              item.path,
            ),
          );
        }
      });
      if (context.examStyle) {
        const blocks = [
          ...sheet.tasks.flatMap((t) => [...t.supported, ...t.stretch]),
          ...(sheet.exitTicket ?? []),
        ];
        if (!blocks.some(isExamItem)) {
          ctx.addIssue(
            editorialIssue(
              "This class sits exams: at least one task needs a marked question that opens with a command word, with its mark scheme as the answer.",
              ["tasks"],
            ),
          );
        }
      }
      for (let c = 1; c <= context.cycles; c++) {
        if (!covered.has(c)) {
          ctx.addIssue(editorialIssue(`Cycle ${c} has no task.`, ["tasks"]));
        }
      }
    });
}
