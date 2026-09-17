import { isAiError } from "@tj/ai";
import type { Finding, Lesson, Worksheet } from "@tj/domain/documents";
import { checkLesson } from "@tj/domain/documents";
import { estimateMinutes, numberQuestions } from "@tj/slides";
import { repairBlock, repairTargets } from "../stages/repair";
import { audienceOf, BUDGET_FINDING, shapeOf } from "../stages/shared";
import { BudgetExceeded, type PipelineDeps, StageFailure, throwIfAborted } from "../types";

/*
 * Check (ADR 0030 items 3.iv and 5; TDD §7 step 4): the worksheet half of `checkLesson` — the
 * findings that name a block on this sheet — plus the fill call's editorial misses and the
 * practice-time rule; `error` findings on blocks get one repair pass through Repair's block
 * branch, then the checks run again. No model Evaluate call: the sheet is a projection of facts
 * Verify has already checked, and its cap is a fifth of the lesson's.
 */

/** The `check` name of the practice-time finding. */
export const PRACTICE_TIME_CHECK = "practice-time";
/** How far `estimateMinutes` may sit from the practice time before it is a finding: 30 %. */
export const PRACTICE_TIME_TOLERANCE_PERCENT = 30;

export function practiceTimeFinding(
  worksheet: Pick<Worksheet, "blocks">,
  practiceMinutes: number,
): Finding | undefined {
  const estimated = estimateMinutes(worksheet.blocks);
  // Integer arithmetic: `practiceMinutes * 0.3` is not exact in floating point.
  if (
    Math.abs(estimated - practiceMinutes) * 100 <=
    practiceMinutes * PRACTICE_TIME_TOLERANCE_PERCENT
  ) {
    return undefined;
  }
  return {
    check: PRACTICE_TIME_CHECK,
    severity: "warning",
    target: {},
    message: `This sheet takes about ${estimated} minutes; it was made for ${practiceMinutes}.`,
  };
}

export interface CheckInput {
  lesson: Lesson;
  worksheet: Worksheet;
  practiceMinutes: number;
  /** The fill call's `spec-rule` findings. */
  findings: Finding[];
}

export interface CheckResult {
  worksheet: Worksheet;
  findings: Finding[];
  /** How many blocks the repair pass rewrote. */
  repaired: number;
}

export type CheckDeps = Pick<
  PipelineDeps,
  "ai" | "budget" | "signal" | "logger" | "context" | "now" | "ids"
>;

export async function checkWorksheet(input: CheckInput, deps: CheckDeps): Promise<CheckResult> {
  const { lesson, practiceMinutes } = input;
  const facts = lesson.facts;
  if (!facts) throw new Error("checkWorksheet: the lesson has no facts");
  const onSheet = (worksheet: Worksheet) => (finding: Finding) =>
    finding.target.blockId !== undefined &&
    worksheet.blocks.some((block) => block.id === finding.target.blockId);
  const before = [
    ...checkLesson(lesson, input.worksheet).filter(onSheet(input.worksheet)),
    ...input.findings,
  ];
  const audience = audienceOf(lesson);
  const { verb, confidence } = shapeOf(lesson);
  const repaired = new Set<string>();
  const extra: Finding[] = [];
  let blocks = input.worksheet.blocks;
  for (const target of repairTargets(before)) {
    if (target.blockId === undefined) continue;
    throwIfAborted(deps.signal);
    const index = blocks.findIndex((block) => block.id === target.blockId);
    const block = blocks[index];
    if (!block) continue;
    try {
      const result = await repairBlock(
        { block, findings: target.findings, facts, audience, lessonShape: { verb, confidence } },
        deps,
      );
      if (!result) continue;
      blocks = blocks.map((b, i) => (i === index ? result.block : b));
      repaired.add(block.id);
      extra.push(...result.findings);
    } catch (error) {
      throwIfAborted(deps.signal);
      if (error instanceof BudgetExceeded) {
        extra.push(BUDGET_FINDING(error.by, "the worksheet repair"));
        break;
      }
      const moderated = isAiError(error, "moderated");
      if (error instanceof StageFailure || moderated) {
        extra.push({
          check: "repair",
          severity: "warning",
          target: { blockId: block.id },
          message: moderated
            ? "The review could not rewrite this block; check it yourself."
            : "This block could not be repaired automatically; please check it.",
        });
        continue;
      }
      throw error;
    }
  }
  const worksheet = { ...input.worksheet, blocks: numberQuestions(blocks) };
  const timing = practiceTimeFinding(worksheet, practiceMinutes);
  const findings = [
    ...checkLesson(lesson, worksheet).filter(onSheet(worksheet)),
    ...input.findings.filter(
      (f) => f.target.blockId === undefined || !repaired.has(f.target.blockId),
    ),
    ...extra,
    ...(timing ? [timing] : []),
  ];
  deps.logger.info(
    {
      blocks: worksheet.blocks.length,
      findings: findings.length,
      errors: findings.filter((f) => f.severity === "error").length,
      repaired: repaired.size,
      practiceTimeWarning: timing !== undefined,
    },
    "worksheet checked",
  );
  return { worksheet, findings, repaired: repaired.size };
}
