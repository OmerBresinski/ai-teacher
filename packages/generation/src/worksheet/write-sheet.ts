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
import { fixNumberArticles } from "./articles";
import type { FillDeps } from "./fill";
import {
  challengeEasierThan,
  challengeRestates,
  type ExamItem,
  type ExamOutput,
  examFaults,
  examSchemaFor,
  giveawayFault,
  type PracticeItem,
  type PracticeOutput,
  practiceFaults,
  practiceSchemaFor,
  repeatedQuestions,
  repeatedResults,
  sameItemPairs,
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
  /** Every item the model wrote and why it was dropped (empty `faults` = kept), for failure logs. */
  verdicts: ItemVerdict[];
};

/** One written item as the model returned it, and the faults that dropped it (none = kept). */
export type ItemVerdict = {
  where: string;
  question: string;
  working: string | null;
  answer: string;
  faults: string[];
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
  verdicts: ItemVerdict[];
} {
  const ctx = { digest };
  const all: [string, PracticeItem][] = [
    ...out.warmUp.map((it, i) => [`warm-up ${i + 1}`, it] as [string, PracticeItem]),
    ...out.core.map((it, i) => [`core ${i + 1}`, it] as [string, PracticeItem]),
    ["the challenge", out.challenge],
  ];
  const repeats = repeatedQuestions(all.map(([, it]) => it.question));
  const findings: Finding[] = [];
  const verdicts: ItemVerdict[] = [];
  const keep = all.map(([where, it], n) => {
    const faults = [
      ...practiceFaults(it, ctx),
      ...(repeats.has(n) ? ["repeats another item"] : []),
    ];
    for (const f of faults) findings.push(drop(where, f));
    verdicts.push(verdictOf(where, it, faults));
    return faults.length === 0;
  });
  // v2: a repeated calculation result is retried once by the schema, never dropped; log what is left.
  const sameResult = repeatedResults(all.map(([, it]) => it));
  all.forEach(([where, _], n) => {
    if (keep[n] && sameResult.has(n))
      findings.push({
        check: "sheet-gate:repeated-result",
        severity: "warning",
        target: { blockId: where },
        message: `Kept ${where}: it has the same calculation result as another item.`,
      });
  });
  const year = digest.lesson.yearGroup;
  itemChecks(all, keep, verdicts, findings, practiceMinimum(year));
  const kept = keep.filter(Boolean).length;
  const enough = kept >= practiceMinimum(year) && keep[keep.length - 1] === true;
  // R3: "A 11 m ribbon" -> "An 11 m ribbon" (fixNumberArticles), logged so the prompt can learn it.
  all.forEach(([where, it]) => {
    if (
      fixNumberArticles(it.question) !== it.question ||
      fixNumberArticles(it.answer) !== it.answer
    )
      findings.push({
        check: "sheet-text:number-article",
        severity: "warning",
        target: { blockId: where },
        message: `Fixed "a"/"an" before a number in ${where}.`,
      });
  });
  const task = (it: PracticeItem) =>
    answeredTaskBlocks(
      {
        question: fixNumberArticles(it.question),
        answer: fixNumberArticles(it.answer),
        ...(it.working ? { working: it.working } : {}),
      },
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
          // v3: the working line only when a core item calculates (it printed on a science sheet).
          instructions(
            ids,
            core.some((it) => it.working?.trim())
              ? "Answer each question. Show your working where there is a calculation."
              : "Answer each question.",
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
  return { blocks, findings, written: all.length, kept, enough, verdicts };
}

/**
 * R5 item checks (12 Nov key check, blind judge): a giveaway, a near-duplicate, and a challenge
 * that restates earlier items or takes fewer steps than one. Each drops one core or warm-up item
 * only while the sheet keeps its minimum (otherwise it is kept and flagged); the challenge is never
 * dropped by these (a dropped challenge fails the sheet), only flagged. Runs on the items that
 * passed `practiceFaults`; `keep`, `verdicts` and `findings` are updated in place.
 */
function itemChecks(
  all: [string, PracticeItem][],
  keep: boolean[],
  verdicts: ItemVerdict[],
  findings: Finding[],
  minimum: number,
): void {
  const last = all.length - 1;
  const flag = (n: number, check: string, fault: string) =>
    findings.push({
      check,
      severity: "warning",
      target: { blockId: all[n]?.[0] ?? "" },
      message: `Kept ${all[n]?.[0]}: ${fault}.`,
    });
  const softDrop = (n: number, check: string, fault: string) => {
    if (!keep[n]) return;
    if (n === last || keep.filter(Boolean).length - 1 < minimum) {
      flag(n, check, n === last ? fault : `${fault} (too few items left to drop it)`);
      return;
    }
    keep[n] = false;
    (verdicts[n] as ItemVerdict).faults.push(fault);
    findings.push(drop(all[n]?.[0] ?? "", fault));
  };
  const live = all.map((_, n) => n).filter((n) => keep[n]);
  const item = (n: number) => {
    const [where, it] = all[n] as [string, PracticeItem];
    const kind = n === last ? "challenge" : where.startsWith("warm") ? "warm-up" : "core";
    return { ...it, where: kind };
  };
  for (const n of live) {
    const g = giveawayFault(item(n));
    if (g) softDrop(n, "sheet-gate:giveaway", g);
  }
  const liveNow = live.filter((n) => keep[n] || n === last);
  for (const [a, b, why] of sameItemPairs(liveNow.map(item))) {
    const later = liveNow[a] as number;
    const earlier = liveNow[b] as number;
    // The challenge stays; the core item it repeats goes instead.
    const target = later === last ? earlier : later;
    const other = target === later ? earlier : later;
    softDrop(target, "sheet-gate:near-duplicate", `${why} ${all[other]?.[0]}`);
  }
  if (!keep[last]) return;
  const before = all.map((_, n) => n).filter((n) => keep[n]);
  const items = before.map(item);
  const restates = challengeRestates(items);
  if (restates)
    flag(
      last,
      "sheet-gate:challenge-restates",
      `the challenge restates ${restates.map((i) => all[before[i] as number]?.[0]).join(" and ")}`,
    );
  const easier = challengeEasierThan(items);
  if (easier !== null)
    flag(
      last,
      "sheet-gate:challenge-easier",
      `the challenge takes fewer steps than ${all[before[easier] as number]?.[0]}`,
    );
}

const verdictOf = (
  where: string,
  it: { question: string; working: string | null },
  faults: string[],
  answer = (it as { answer?: string }).answer ?? "",
): ItemVerdict => ({ where, question: it.question, working: it.working, answer, faults });

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
  verdicts: ItemVerdict[];
} {
  const ctx = { digest };
  const repeats = repeatedQuestions(out.items.map((it) => it.question));
  const findings: Finding[] = [];
  const kept: ExamItem[] = [];
  const verdicts: ItemVerdict[] = [];
  out.items.forEach((it, i) => {
    const faults = [
      ...examFaults(it, marks[i], ctx),
      ...(i >= marks.length ? ["is beyond the planned questions"] : []),
      ...(repeats.has(i) ? ["repeats another question"] : []),
    ];
    for (const f of faults) findings.push(drop(`question ${i + 1}`, f));
    verdicts.push(verdictOf(`question ${i + 1}`, it, faults, it.markScheme.join("; ")));
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
  return { blocks, findings, written: out.items.length, kept: kept.length, enough, verdicts };
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
