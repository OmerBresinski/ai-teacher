import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { Finding, Lesson, WorksheetBlock } from "@tj/domain/documents";
import { docFromText, estimateMinutes, resolveRecipe } from "@tj/slides";
import { repairPrompt } from "../prompts";
import { assignFactIds } from "../specs";
import {
  callLimitedBudget,
  FIXTURES,
  recordingDeps,
  routed,
  sampleBriefLesson,
  scriptedWorksheetAi,
} from "../testing";
import { checkWorksheet, PRACTICE_TIME_CHECK, practiceTimeFinding } from "./check";
import { fillFrame } from "./fill";
import { buildFrame } from "./frame";

const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
const lesson: Lesson = { ...sampleBriefLesson(), facts };
const json = (value: unknown) => JSON.stringify(value);

/** A fake answering `n` block repairs with the fixture's first fill block. */
const repairAi = (n: number) =>
  createFakeAi({
    script: routed(
      Array.from({ length: n }, () => json(FIXTURES.worksheetFill.slots[0]?.blocks[0])),
    ),
    usage: { inputTokens: 1000, outputTokens: 400 },
  });

async function filledSheet(practiceMinutes = 13) {
  const recipe = resolveRecipe("knowledge-check", facts);
  const frame = buildFrame(
    { recipe, facts, lesson, worksheetId: "ws-1", practiceMinutes },
    { now: () => new Date("2026-09-17T10:00:00.000Z") },
  );
  const fill = await fillFrame(
    { ...frame, recipe, lesson, facts, practiceMinutes },
    recordingDeps(scriptedWorksheetAi()),
  );
  return fill.worksheet;
}

describe("checkWorksheet", () => {
  test("a clean sheet: no findings, no call, the blocks unchanged", async () => {
    const worksheet = await filledSheet();
    const ai = repairAi(1);
    const result = await checkWorksheet(
      { lesson, worksheet, practiceMinutes: 10, findings: [] },
      recordingDeps(ai),
    );
    expect(ai.calls).toHaveLength(0);
    expect(result.findings).toEqual([]);
    expect(result.repaired).toBe(0);
    expect(result.worksheet.blocks).toEqual(worksheet.blocks);
  });

  test("a block with no answer is an error the check finds and one repair pass rewrites", async () => {
    const worksheet = await filledSheet();
    const index = worksheet.blocks.findIndex((b) => b.type === "question");
    const broken = { ...(worksheet.blocks[index] as WorksheetBlock), answer: "" } as WorksheetBlock;
    const blocks = worksheet.blocks.map((b, i) => (i === index ? broken : b));
    const repaired = json({
      type: "question",
      text: "Describe how the particles are arranged in a solid.",
      answer: "Packed closely in a regular pattern, vibrating in place.",
      answerLines: 2,
      marks: 1,
      factRefs: ["q6", "o1"],
    });
    const ai = createFakeAi({ script: routed([repaired]) });
    const result = await checkWorksheet(
      { lesson, worksheet: { ...worksheet, blocks }, practiceMinutes: 10, findings: [] },
      recordingDeps(ai),
    );
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.context).toMatchObject({
      stage: "repair",
      promptVersion: repairPrompt.version,
    });
    expect(result.repaired).toBe(1);
    // Same id, new content, the findings recomputed clean.
    const fresh = result.worksheet.blocks[index];
    expect(fresh?.id).toBe(broken.id);
    expect(fresh?.type === "question" && fresh.answer).toContain("Packed closely");
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(
      result.worksheet.blocks.filter((b) => b.type === "question").map((b) => b.number),
    ).toEqual([1, 2]);
  });

  test("the fill's spec-rule errors are repaired once; a miss on the repair is a warning, never a second pass", async () => {
    const worksheet = await filledSheet();
    const target = worksheet.blocks.at(-1) as WorksheetBlock;
    const findings: Finding[] = [
      {
        check: "spec-rule",
        severity: "error",
        target: { blockId: target.id },
        message: "Too long.",
      },
    ];
    const ai = repairAi(1);
    const result = await checkWorksheet(
      { lesson, worksheet, practiceMinutes: 10, findings },
      recordingDeps(ai),
    );
    expect(ai.calls.map((c) => c.context?.stage)).toEqual(["repair"]);
    expect(result.repaired).toBe(1);
    // The error is gone; the repair answer duplicates a fixture item, which the recomputed
    // quality check reports as the warning it is.
    expect(
      result.findings.filter((f) => f.target.blockId === target.id && f.severity === "error"),
    ).toEqual([]);
  });

  test("a budget stop between repairs records the budget finding and keeps the sheet", async () => {
    const worksheet = await filledSheet();
    const target = worksheet.blocks.at(-1) as WorksheetBlock;
    const findings: Finding[] = [
      {
        check: "spec-rule",
        severity: "error",
        target: { blockId: target.id },
        message: "Too long.",
      },
    ];
    const ai = repairAi(1);
    const result = await checkWorksheet(
      { lesson, worksheet, practiceMinutes: 10, findings },
      recordingDeps(ai, { budget: callLimitedBudget(0) }),
    );
    expect(ai.calls).toHaveLength(0);
    expect(result.findings.map((f) => f.check)).toEqual(["spec-rule", "budget"]);
    expect(result.worksheet.blocks).toEqual(worksheet.blocks);
  });

  test("a sheet more than 30% away from its practice time gets one warning", async () => {
    const worksheet = await filledSheet();
    const minutes = estimateMinutes(worksheet.blocks);
    expect(practiceTimeFinding(worksheet, minutes)).toBeUndefined();
    const far = practiceTimeFinding(worksheet, minutes * 3);
    expect(far).toMatchObject({ check: PRACTICE_TIME_CHECK, severity: "warning", target: {} });
    const result = await checkWorksheet(
      { lesson, worksheet, practiceMinutes: minutes * 3, findings: [] },
      recordingDeps(scriptedWorksheetAi()),
    );
    expect(result.findings).toEqual([far as Finding]);
    // 10 minutes for a sheet that reads as 10 (or 13 → within 30%): nothing.
    expect(practiceTimeFinding(worksheet, 13)).toBeUndefined();
  });

  test("only findings on this sheet's blocks count: a lesson-level or slide finding is not the sheet's", async () => {
    const worksheet = await filledSheet();
    // Add an unanswered question to a copy of the lesson's *slides*? No slides here; instead a
    // block that is not on the sheet in the fill findings.
    const findings: Finding[] = [
      { check: "spec-rule", severity: "error", target: { blockId: "not-here" }, message: "x" },
      { check: "pitch", severity: "warning", target: {}, message: "y" },
    ];
    const ai = repairAi(1);
    const result = await checkWorksheet(
      { lesson, worksheet, practiceMinutes: 10, findings },
      recordingDeps(ai),
    );
    expect(ai.calls).toHaveLength(0);
    expect(result.findings).toEqual(findings);
  });

  test("a block type the pipeline cannot regenerate is left as it is", async () => {
    const worksheet = await filledSheet();
    const image: WorksheetBlock = {
      id: "img",
      type: "image",
      src: "data:,",
      alt: "",
      widthPct: 50,
    } as WorksheetBlock;
    const findings: Finding[] = [
      { check: "spec-rule", severity: "error", target: { blockId: "img" }, message: "x" },
    ];
    const ai = repairAi(1);
    const result = await checkWorksheet(
      {
        lesson,
        worksheet: { ...worksheet, blocks: [...worksheet.blocks, image] },
        practiceMinutes: 10,
        findings,
      },
      recordingDeps(ai),
    );
    expect(ai.calls).toHaveLength(0);
    expect(result.repaired).toBe(0);
    expect(result.findings).toEqual(findings);
    void docFromText;
  });
});
