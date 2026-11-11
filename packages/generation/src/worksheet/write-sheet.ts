import type { Finding, WorksheetBlock } from "@tj/domain/documents";
import { docFromText } from "@tj/slides";
import { answerLinesForMarks } from "@tj/slides/worksheet";
import type { LessonDigest } from "@tj/slides/worksheet/digest";
import { answeredTaskBlocks } from "@tj/slides/worksheet/exit-sheet";
import { type CallUsage, callStructured, MAX_OUTPUT_TOKENS, specRuleFinding } from "../call";
import {
  bandOf,
  examMarksPlan,
  examPrompt,
  practiceCounts,
  practicePrompt,
} from "../prompts/worksheet-sheet";
import type { FillDeps } from "./fill";
import {
  type ExamItem,
  type ExamOutput,
  examFaults,
  examSchemaFor,
  type PracticeItem,
  type PracticeOutput,
  practiceFaults,
  practiceSchemaFor,
  repeatedQuestions,
} from "./sheet-items";

/*
 * `writeSheet` (worksheets plan v2 T7): one `small` call at effort `low` for Practice or Exam
 * practice, with `callStructured`'s one retry; then the items code can prove wrong are dropped
 * (`practiceFaults` / `examFaults`) and the rest become blocks. The model never writes blocks:
 * headings, instructions, numbering, answer space and marks are code's.
 */

export type WrittenSheet = {
  blocks: WorksheetBlock[];
  findings: Finding[];
  /** Items the model wrote and items that survived the drop. */
  written: number;
  kept: number;
  promptVersion: string;
  modelId: string;
  usage: CallUsage;
  /** False when too few items survived: the sheet fails `too-few-checked`. */
  enough: boolean;
};

const drop = (where: string, fault: string, id = where): Finding => ({
  check: "sheet-gate:item",
  severity: "warning",
  target: { blockId: id },
  message: `Dropped ${where}: ${fault}.`,
});

const heading = (ids: () => string, text: string): WorksheetBlock => ({
  id: ids(),
  type: "heading",
  doc: docFromText(text),
  level: 2,
});
const instructions = (ids: () => string, text: string): WorksheetBlock => ({
  id: ids(),
  type: "instructions",
  doc: docFromText(text),
});

/** The minimum Practice items after drops (schemas.md): Years 1-2 4, otherwise 6; the challenge survives. */
export const practiceMinimum = (yearGroup: string) => (bandOf(yearGroup) === "y1-2" ? 4 : 6);

/** Practice items through the gate, then into the plan's three headed sections. */
export function practiceBlocks(
  out: PracticeOutput,
  digest: LessonDigest,
  ids: () => string,
): {
  blocks: WorksheetBlock[];
  findings: Finding[];
  written: number;
  kept: number;
  enough: boolean;
} {
  const ctx = { digest };
  const all: [string, PracticeItem][] = [
    ...out.warmUp.map((it, i) => [`warm-up ${i + 1}`, it] as [string, PracticeItem]),
    ...out.core.map((it, i) => [`core ${i + 1}`, it] as [string, PracticeItem]),
    ["the challenge", out.challenge],
  ];
  const repeats = repeatedQuestions(all.map(([, it]) => it.question));
  const findings: Finding[] = [];
  const keep = all.map(([where, it], n) => {
    const faults = [
      ...practiceFaults(it, ctx),
      ...(repeats.has(n) ? ["repeats another item"] : []),
    ];
    for (const f of faults) findings.push(drop(where, f));
    return faults.length === 0;
  });
  const year = digest.lesson.yearGroup;
  const kept = keep.filter(Boolean).length;
  const enough = kept >= practiceMinimum(year) && keep[keep.length - 1] === true;
  const task = (it: PracticeItem) =>
    answeredTaskBlocks(
      { question: it.question, answer: it.answer, ...(it.working ? { working: it.working } : {}) },
      year,
      ids,
      { split: false },
    );
  const warm = out.warmUp.filter((_, i) => keep[i]);
  const core = out.core.filter((_, i) => keep[out.warmUp.length + i]);
  const blocks: WorksheetBlock[] = [
    ...(warm.length
      ? [heading(ids, "Warm up"), instructions(ids, "Answer each question."), ...warm.flatMap(task)]
      : []),
    ...(core.length
      ? [
          heading(ids, "Practice"),
          instructions(
            ids,
            "Answer each question. Show your working where there is a calculation.",
          ),
          ...core.flatMap(task),
        ]
      : []),
    ...(keep[keep.length - 1]
      ? [
          heading(ids, "Challenge"),
          instructions(ids, "Take this one step further."),
          ...task(out.challenge),
        ]
      : []),
  ];
  return { blocks, findings, written: all.length, kept, enough };
}

/** Exam items through the gate, each with its code-set marks; the key is the mark scheme. */
export function examBlocks(
  out: ExamOutput,
  digest: LessonDigest,
  marks: number[],
  ids: () => string,
): {
  blocks: WorksheetBlock[];
  findings: Finding[];
  written: number;
  kept: number;
  enough: boolean;
} {
  const ctx = { digest };
  const repeats = repeatedQuestions(out.items.map((it) => it.question));
  const findings: Finding[] = [];
  const kept: ExamItem[] = [];
  out.items.forEach((it, i) => {
    const faults = [
      ...examFaults(it, marks[i], ctx),
      ...(i >= marks.length ? ["is beyond the planned questions"] : []),
      ...(repeats.has(i) ? ["repeats another question"] : []),
    ];
    for (const f of faults) findings.push(drop(`question ${i + 1}`, f));
    if (faults.length === 0) kept.push(it);
  });
  const total = kept.reduce((sum, it) => sum + it.marks, 0);
  const enough = total >= 15 && kept.some((it) => it.marks >= 4);
  const blocks: WorksheetBlock[] = [
    heading(ids, "Exam practice"),
    instructions(ids, "Answer all questions. The marks for each question are in brackets."),
    ...kept.map(
      (it): WorksheetBlock => ({
        id: ids(),
        type: "question",
        doc: docFromText(it.question),
        answerLines: answerLinesForMarks(it.marks),
        marks: it.marks,
        // One point per mark, in order. "; " not "\n": the key prints an answer as one run of
        // text, so new lines ran the points together (render, 11 Nov).
        answer: it.markScheme.map((p) => p.trim()).join("; "),
      }),
    ),
  ];
  return { blocks, findings, written: out.items.length, kept: kept.length, enough };
}

export type WriteSheetInput = {
  type: "practice" | "exam-style";
  digest: LessonDigest;
  practiceMinutes: number;
};

/** One model call, the gate, the blocks. A shape miss twice throws `StageFailure` (could-not-write). */
export async function writeSheet(input: WriteSheetInput, deps: FillDeps): Promise<WrittenSheet> {
  const { digest } = input;
  const year = digest.lesson.yearGroup;
  if (input.type === "practice") {
    const counts = practiceCounts(year, input.practiceMinutes);
    const ctx = { digest, core: counts.core };
    const prompt = practicePrompt(year);
    const call = await callStructured({
      deps,
      stage: "worksheet",
      cls: "small",
      effort: "low",
      prompt,
      input: { digest, counts },
      schema: practiceSchemaFor(ctx),
      soft: practiceSchemaFor(ctx, { soft: true }),
      maxOutputTokens: MAX_OUTPUT_TOKENS.worksheet,
    });
    const built = practiceBlocks(call.output, digest, deps.ids);
    return {
      ...built,
      findings: [
        ...call.editorialMisses.map((m) => specRuleFinding(m, {}, "warning")),
        ...built.findings,
      ],
      promptVersion: prompt.version,
      modelId: call.modelId,
      usage: call.usage,
    };
  }
  const marks = examMarksPlan(digest);
  const prompt = examPrompt(year);
  const call = await callStructured({
    deps,
    stage: "worksheet",
    cls: "small",
    effort: "low",
    prompt,
    input: { digest, marks },
    schema: examSchemaFor({ digest, marks }),
    soft: examSchemaFor({ digest, marks }, { soft: true }),
    maxOutputTokens: MAX_OUTPUT_TOKENS.worksheet,
  });
  const built = examBlocks(call.output, digest, marks, deps.ids);
  return {
    ...built,
    findings: [
      ...call.editorialMisses.map((m) => specRuleFinding(m, {}, "warning")),
      ...built.findings,
    ],
    promptVersion: prompt.version,
    modelId: call.modelId,
    usage: call.usage,
  };
}
