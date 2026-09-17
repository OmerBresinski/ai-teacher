import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { type Lesson, parseWorksheet, TASK_BLOCK_TYPES } from "@tj/domain/documents";
import { docFromText, isPlaceholder, resolveRecipe } from "@tj/slides";
import { generateWorksheetFillPrompt } from "../prompts";
import { assignFactIds } from "../specs";
import { stemPlan } from "../stages/question-pool";
import {
  FIXTURES,
  recordingDeps,
  routed,
  sampleBriefLesson,
  scriptedWorksheetAi,
} from "../testing";
import { StageFailure } from "../types";
import { fillFrame, withInstructions } from "./fill";
import { buildFrame } from "./frame";

const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
const lesson: Lesson = { ...sampleBriefLesson(), facts };
const json = (value: unknown) => JSON.stringify(value);

function frameFor(id: Parameters<typeof resolveRecipe>[0], practiceMinutes: number) {
  const recipe = resolveRecipe(id, facts);
  const deps = { now: () => new Date("2026-09-17T10:00:00.000Z") };
  return {
    recipe,
    ...buildFrame({ recipe, facts, lesson, worksheetId: "ws-1", practiceMinutes }, deps),
  };
}

describe("fillFrame", () => {
  test("one small low-effort call fills the knowledge-check slot; the blocks replace the placeholder, stamped", async () => {
    const ai = scriptedWorksheetAi();
    const deps = recordingDeps(ai);
    const frame = frameFor("knowledge-check", 13);
    const result = await fillFrame({ ...frame, lesson, facts, practiceMinutes: 13 }, deps);

    expect(ai.calls).toHaveLength(1);
    const call = ai.calls[0];
    expect(call?.context).toMatchObject({
      stage: "worksheet",
      promptVersion: generateWorksheetFillPrompt.version,
      effort: "low",
      jobId: deps.context.jobId,
    });
    expect(ai.modelId("small")).toBe(result.modelId as string);
    // The prompt carries the recipe, its one slot and the pool; never a reserved stem as a pool line.
    expect(call?.promptText).toContain(
      "Recipe: knowledge-check (check). The filled blocks take about 13 minutes.",
    );
    expect(call?.promptText).toContain("slot 3: 1–6 blocks; types: multiple-choice");
    const { reservedForWorksheet } = stemPlan(facts);
    expect(result.reservedStems).toEqual(reservedForWorksheet);
    for (const stem of reservedForWorksheet) {
      expect(call?.promptText).toContain(`  - ${stem}`);
    }

    const sheet = result.worksheet;
    expect(() => parseWorksheet(sheet)).not.toThrow();
    expect(sheet.blocks.some(isPlaceholder)).toBe(false);
    expect(sheet.blocks.map((b) => b.type)).toEqual([
      "instructions",
      "question",
      "question",
      "multiple-choice",
      "multiple-choice",
      "multiple-choice",
    ]);
    const filled = sheet.blocks.slice(3);
    for (const block of filled) {
      expect(block.authoredBy).toBe("ai");
      expect(block.generatedFrom).toMatchObject({
        promptVersion: generateWorksheetFillPrompt.version,
        model: ai.modelId("small"),
      });
    }
    expect(filled.map((b) => b.generatedFrom?.factRefs)).toEqual([
      ["q6", "o1"],
      ["q13", "o2"],
      ["q10", "o3"],
    ]);
    // Numbered through: two questions then three items.
    expect(sheet.blocks.slice(1).map((b) => (b as { number?: number }).number)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(result.findings).toEqual([]);
  });

  test("a stem the exit-ticket slide owns is reserved from the sheet and absent from it", async () => {
    const { pool, reservedForWorksheet } = stemPlan(facts);
    // q8 is an `exit` question: the check slide's, never the sheet's.
    const exitStem = facts.questions.find((q) => q.id === "q8")?.stem as string;
    expect(reservedForWorksheet).toContain(exitStem);
    expect(pool.map((q) => q.id)).not.toContain("q8");
    const result = await fillFrame(
      { ...frameFor("knowledge-check", 13), lesson, facts, practiceMinutes: 13 },
      recordingDeps(scriptedWorksheetAi()),
    );
    expect(JSON.stringify(result.worksheet.blocks)).not.toContain(exitStem);
  });

  test("the schema admits only the recipe's slot types: a question in the knowledge-check slot is a shape miss, retried once, then the call fails", async () => {
    const wrong = json({
      slots: [
        {
          index: 3,
          blocks: [
            {
              type: "question",
              text: "Why can you pour a liquid?",
              answer: "Its particles slide past each other.",
              answerLines: 2,
              marks: 1,
              factRefs: ["q7", "o1"],
            },
          ],
        },
      ],
    });
    const ai = createFakeAi({ script: routed([wrong, wrong]) });
    await expect(
      fillFrame(
        { ...frameFor("knowledge-check", 13), lesson, facts, practiceMinutes: 13 },
        recordingDeps(ai),
      ),
    ).rejects.toBeInstanceOf(StageFailure);
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[1]?.promptText).toContain('"question" is not one of them');
  });

  test("exit ticket at 10 minutes: the slot admits questions only and at most two", async () => {
    const frame = frameFor("exit-ticket", 10);
    expect(frame.fillSlots).toEqual([{ index: 5, allowedTypes: ["question"], count: [1, 2] }]);
    const answer = json({
      slots: [
        {
          index: 5,
          blocks: [
            {
              type: "question",
              text: "Why can you pour a liquid but not a solid?",
              answer: "Liquid particles slide past each other; solid particles are fixed.",
              answerLines: 4,
              marks: 2,
              factRefs: ["q7", "o1"],
            },
          ],
        },
      ],
    });
    const result = await fillFrame(
      { ...frame, lesson, facts, practiceMinutes: 10 },
      recordingDeps(scriptedWorksheetAi({ fill: answer })),
    );
    expect(result.worksheet.blocks.at(-1)?.type).toBe("question");
    expect(result.worksheet.blocks.filter((b) => b.type === "question")).toHaveLength(4);
  });

  test("an editorial miss on the accepted retry is a spec-rule error on the block it names", async () => {
    // Stretch before easy: the tier-order rule, editorial. Both attempts the same.
    const reordered = json({
      slots: [
        {
          index: 3,
          blocks: [...(FIXTURES.worksheetFill.slots[0]?.blocks ?? [])].reverse(),
        },
      ],
    });
    const ai = createFakeAi({ script: routed([reordered, reordered]) });
    const result = await fillFrame(
      { ...frameFor("knowledge-check", 13), lesson, facts, practiceMinutes: 13 },
      recordingDeps(ai),
    );
    expect(ai.calls).toHaveLength(2);
    expect(result.worksheet.blocks).toHaveLength(6);
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding).toMatchObject({ check: "spec-rule", severity: "error" });
      expect(result.worksheet.blocks.some((b) => b.id === finding.target.blockId)).toBe(true);
    }
  });

  test("a recipe with no slot makes no call and still gets its instruction lines", async () => {
    const ai = scriptedWorksheetAi();
    const frame = frameFor("word-search", 13);
    const result = await fillFrame(
      { ...frame, lesson, facts, practiceMinutes: 13 },
      recordingDeps(ai),
    );
    expect(ai.calls).toHaveLength(0);
    expect(result.modelId).toBeUndefined();
    expect(result.worksheet.blocks[0]?.type).toBe("word-search");
  });
});

describe("withInstructions (ruling 61)", () => {
  const block = (
    type:
      | "matching"
      | "multiple-choice"
      | "fill-gap"
      | "word-bank"
      | "heading"
      | "instructions"
      | "question",
    id: string,
  ) =>
    ({
      id,
      type,
      ...(type === "matching" ? { pairs: [] } : {}),
      ...(type === "multiple-choice" ? { options: [] } : {}),
      ...(type === "fill-gap" ? { gaps: [] } : {}),
      ...(type === "word-bank" ? { words: [] } : {}),
      ...(type === "heading" ? { level: 1 } : {}),
      ...(type === "question" ? { answerLines: 2 } : {}),
      ...(type === "matching" || type === "word-bank" ? {} : { doc: docFromText("x") }),
    }) as never;

  test("a task block with no instruction since the last heading gets the guide's line before it", () => {
    const out = withInstructions([block("heading", "h"), block("matching", "m")]);
    expect(out.map((b) => b.type)).toEqual(["heading", "instructions", "matching"]);
    expect(JSON.stringify(out[1])).toContain("Match");
  });

  test("a standing line covers the same kind; a task of another kind brings its own", () => {
    const out = withInstructions([
      block("instructions", "i"),
      block("multiple-choice", "a"),
      block("multiple-choice", "b"),
      block("matching", "m"),
    ]);
    expect(out.map((b) => b.type)).toEqual([
      "instructions",
      "multiple-choice",
      "multiple-choice",
      "instructions",
      "matching",
    ]);
  });

  test("the word bank and its fill-gap share one line; a question needs none", () => {
    const out = withInstructions([
      block("instructions", "i"),
      block("word-bank", "w"),
      block("fill-gap", "g"),
      block("question", "q"),
    ]);
    expect(out.map((b) => b.type)).toEqual(["instructions", "word-bank", "fill-gap", "question"]);
    expect(TASK_BLOCK_TYPES).not.toContain("question");
  });
});
