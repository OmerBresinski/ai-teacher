import { describe, expect, test } from "bun:test";
import { type Lesson, parseWorksheet } from "@tj/domain/documents";
import { estimateMinutes, isPlaceholder, RECIPE_PROMPT_VERSION, resolveRecipe } from "@tj/slides";
import { assignFactIds } from "../specs";
import { FIXTURES, sampleBriefLesson } from "../testing";
import {
  buildFrame,
  MAX_SLOT_BLOCKS,
  objectivesPractisedBy,
  SLOT_BLOCK_MINUTES,
  slotCount,
} from "./frame";

const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
const lesson: Lesson = { ...sampleBriefLesson({ readingLevel: "core" }), facts };
const deps = { now: () => new Date("2026-09-17T10:00:00.000Z") };

describe("buildFrame", () => {
  test("knowledge check: the recipe's blocks, the lesson's header and link, one slot at the placeholder", () => {
    const recipe = resolveRecipe("knowledge-check", facts);
    const { worksheet, fillSlots } = buildFrame(
      { recipe, facts, lesson, worksheetId: "ws-1", practiceMinutes: 13 },
      deps,
    );
    expect(() => parseWorksheet(worksheet)).not.toThrow();
    expect(worksheet.id).toBe("ws-1");
    expect(worksheet.lessonId).toBe(lesson.id);
    expect(worksheet.title).toBe(lesson.title);
    expect(worksheet.header).toMatchObject({
      showName: true,
      showDate: true,
      showClass: true,
      title: lesson.title,
      subtitle: expect.stringMatching(/^I can /),
    });
    expect(worksheet.header.criteria).toHaveLength(facts.objectives.length);
    expect(worksheet).toMatchObject({
      themeId: lesson.themeId,
      ageBand: lesson.ageBand,
      yearGroup: lesson.yearGroup,
      subject: lesson.subject,
      readingLevel: "core",
      language: lesson.language,
      includeAnswerKey: true,
      pageSize: "A4",
      createdAt: "2026-09-17T10:00:00.000Z",
    });
    expect(worksheet.showMarks).toBeUndefined();
    expect(worksheet.blocks.map((b) => b.type)).toEqual([
      "instructions",
      "question",
      "question",
      "paragraph",
    ]);
    // Questions numbered; the frame's blocks stamped with the recipe version.
    expect(worksheet.blocks.filter((b) => b.type === "question").map((b) => b.number)).toEqual([
      1, 2,
    ]);
    for (const block of worksheet.blocks) {
      expect(block.generatedFrom?.promptVersion).toBe(RECIPE_PROMPT_VERSION);
    }
    expect(fillSlots).toEqual([{ index: 3, allowedTypes: ["multiple-choice"], count: [1, 6] }]);
    expect(isPlaceholder(worksheet.blocks[3] as never)).toBe(true);
  });

  test("the slot count follows the practice time: exit ticket at 5 minutes takes one question", () => {
    const recipe = resolveRecipe("exit-ticket", facts);
    const at5 = buildFrame({ recipe, facts, lesson, worksheetId: "w", practiceMinutes: 5 }, deps);
    expect(at5.fillSlots).toEqual([{ index: 5, allowedTypes: ["question"], count: [1, 1] }]);
    const at10 = buildFrame({ recipe, facts, lesson, worksheetId: "w", practiceMinutes: 10 }, deps);
    expect(at10.fillSlots[0]?.count).toEqual([1, 2]);
    // Three one-mark questions and the box: the frame alone reads as five minutes.
    expect(estimateMinutes(at5.worksheet.blocks)).toBe(5);
  });

  test("slotCount: at least one, at most what the minutes buy at the cheapest type, capped", () => {
    expect(slotCount(0, ["question"])).toEqual([1, 1]);
    expect(slotCount(-3, ["question"])).toEqual([1, 1]);
    expect(slotCount(6, ["question"])).toEqual([1, 2]);
    expect(slotCount(6, ["question", "multiple-choice"])).toEqual([1, 6]);
    expect(slotCount(100, ["multiple-choice"])).toEqual([1, MAX_SLOT_BLOCKS]);
    expect(SLOT_BLOCK_MINUTES.question).toBe(3);
    expect(SLOT_BLOCK_MINUTES["multiple-choice"]).toBe(1);
  });

  test("the exam paper and the word search leave no slot; an assessment shows marks", () => {
    const exam = buildFrame(
      {
        recipe: resolveRecipe("exam-style", facts),
        facts,
        lesson,
        worksheetId: "w",
        practiceMinutes: 38,
      },
      deps,
    );
    expect(exam.fillSlots).toEqual([]);
    expect(exam.worksheet.showMarks).toBe(true);
    const grid = buildFrame(
      {
        recipe: resolveRecipe("word-search", facts),
        facts,
        lesson,
        worksheetId: "w",
        practiceMinutes: 13,
      },
      deps,
    );
    expect(grid.fillSlots).toEqual([]);
    expect(grid.worksheet.blocks[0]?.type).toBe("word-search");
  });

  test("the reading passage slot allows paragraphs only, ahead of the questions", () => {
    const { worksheet, fillSlots } = buildFrame(
      {
        recipe: resolveRecipe("reading", facts),
        facts,
        lesson,
        worksheetId: "w",
        practiceMinutes: 25,
      },
      deps,
    );
    expect(fillSlots).toEqual([{ index: 2, allowedTypes: ["paragraph"], count: [1, 6] }]);
    expect(worksheet.blocks.slice(3).every((b) => b.type === "question")).toBe(true);
  });

  test("objectivesPractisedBy reads the frame's citations through the fact graph, not the placeholder", () => {
    const { worksheet } = buildFrame(
      {
        recipe: resolveRecipe("knowledge-check", facts),
        facts,
        lesson,
        worksheetId: "w",
        practiceMinutes: 13,
      },
      deps,
    );
    // q1 → o1 and q2 → o2 by their objectiveRefs (and whatever the outline links them to).
    const practised = objectivesPractisedBy(worksheet, facts);
    expect(practised).toContain("o1");
    expect(practised).toContain("o2");
    // The placeholder alone cites nothing that counts.
    const placeholderOnly = { ...worksheet, blocks: worksheet.blocks.slice(3) };
    expect(objectivesPractisedBy(placeholderOnly, facts)).toEqual([]);
  });
});
