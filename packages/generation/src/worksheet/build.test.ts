import { describe, expect, test } from "bun:test";
import {
  isUnfinishedWorksheet,
  richDocToPlainText,
  type WorksheetBlock,
  WorksheetSchema,
} from "@tj/domain/documents";
import { docFromText } from "@tj/slides";
import { fixtureLesson, type WorksheetFixtureName } from "@tj/slides/worksheet/fixtures";
import { buildSheet, SheetBuildFailure } from "./build";
import { gateSheet, isNonAnswer } from "./gate";

/*
 * T6 (worksheets plan v2 §3, §5): the new sheet path. `buildSheet` reads the lesson's slides
 * through the digest, builds the Exit ticket with no model call and gates it; `gateSheet` drops
 * anything that may not ship and fails a sheet left with too few items.
 */

const now = () => new Date("2026-11-11T09:00:00.000Z");
const build = (name: WorksheetFixtureName) =>
  buildSheet({
    recipeId: "exit-ticket",
    lesson: fixtureLesson(name, { facts: undefined }),
    worksheetId: `ws-${name}`,
    now,
  });

const q = (id: string, text: string, answer?: string): WorksheetBlock => ({
  id,
  type: "question",
  doc: docFromText(text),
  answerLines: 2,
  ...(answer !== undefined ? { answer } : {}),
});

describe("buildSheet: Exit ticket per fixture", () => {
  test.each([
    ["halves", 2],
    ["romans", 3],
    ["rivers", 3],
    ["rates", 3],
  ] as const)("%s: a finished, valid sheet with %i answered questions", (name, count) => {
    const { worksheet, findings } = build(name);
    expect(() => WorksheetSchema.parse(worksheet)).not.toThrow();
    const qs = worksheet.blocks.filter((b) => b.type === "question");
    expect(qs).toHaveLength(count);
    expect(qs.every((b) => b.type === "question" && !isNonAnswer(b.answer))).toBe(true);
    expect(findings).toEqual([]);
    // The header rule (T3): the title, then the objectives as "I can" lines.
    expect(worksheet.header.title).toBe(worksheet.title);
    expect(worksheet.header.criteria?.length).toBeGreaterThan(0);
    expect(worksheet.header.criteria?.every((c) => c.startsWith("I can"))).toBe(true);
    expect(worksheet.includeAnswerKey).toBe(true);
    expect(worksheet.lessonId).toBe(`fixture-${name}`);
    // With a completed generation it is not unfinished.
    expect(
      isUnfinishedWorksheet({
        ...worksheet,
        generation: {
          jobId: "j",
          stage: "checked",
          startedAt: now().toISOString(),
          completedAt: now().toISOString(),
          promptVersions: {},
          usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
          findings: [],
          recipeId: "exit-ticket",
          practiceMinutes: 5,
        },
      }),
    ).toBe(false);
  });

  test("a teacher's edit to the exit slide carries over", () => {
    const lesson = fixtureLesson("rivers");
    const exit = lesson.slides.find((s) => s.kind === "exit-ticket");
    if (exit?.question?.type !== "open-response") throw new Error("no exit slide");
    exit.question.modelAnswer = (exit.question.modelAnswer ?? "").replace(
      "Water flows more slowly there",
      "The current is slowest on the inside",
    );
    const { worksheet } = buildSheet({ recipeId: "exit-ticket", lesson, worksheetId: "w", now });
    const answers = worksheet.blocks.flatMap((b) => (b.type === "question" ? [b.answer] : []));
    expect(answers[1]).toBe("The current is slowest on the inside, so sediment is deposited.");
  });

  test("a lesson with no exit-ticket slide fails not-enough-lesson", () => {
    const lesson = fixtureLesson("rivers");
    lesson.slides = lesson.slides.filter((s) => s.kind !== "exit-ticket");
    try {
      buildSheet({ recipeId: "exit-ticket", lesson, worksheetId: "w", now });
      throw new Error("expected a failure");
    } catch (error) {
      expect(error).toBeInstanceOf(SheetBuildFailure);
      expect((error as SheetBuildFailure).code).toBe("not-enough-lesson");
    }
  });

  test("a type not built yet throws (the API refuses it first)", () => {
    expect(() =>
      buildSheet({ recipeId: "practice", lesson: fixtureLesson("rivers"), worksheetId: "w", now }),
    ).toThrow("not built yet");
  });
});

describe("gateSheet", () => {
  test("drops a question with no answer, a placeholder key and a repeat; renumbers the rest", () => {
    const result = gateSheet({
      type: "exit-ticket",
      yearGroup: "Year 9",
      blocks: [
        q("a", "What is erosion?", "The wearing away of land."),
        q("b", "What is deposition?", ""),
        q("c", "What is a meander?", "No answer recorded"),
        q("d", "Name a river landform.", "…"),
        q("e", "What is erosion?", "Wearing away."),
        q("f", "Why do meanders migrate?", "Erosion on the outer bank."),
      ],
    });
    expect(result.ok).toBe(true);
    const kept = result.blocks.flatMap((b) =>
      b.type === "question" ? [[b.id, b.number] as const] : [],
    );
    expect(kept).toEqual([
      ["a", 1],
      ["f", 2],
    ]);
    expect(result.findings.map((f) => f.check)).toEqual([
      "sheet-gate:no-answer",
      "sheet-gate:no-answer",
      "sheet-gate:no-answer",
      "sheet-gate:repeated-question",
    ]);
    expect(result.findings.every((f) => f.severity === "warning")).toBe(true);
  });

  test("too few left after the drops fails too-few-checked, never pads", () => {
    const result = gateSheet({
      type: "exit-ticket",
      yearGroup: "Year 4",
      blocks: [q("a", "When was the wall built?", "AD 122"), q("b", "Who built it?", "N/A")],
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("too-few-checked");
  });

  test("Years 1-2 drop a spoken task; Year 9 keeps it", () => {
    const blocks = [
      q("a", "Tell your partner what half means.", "Two equal parts."),
      q("b", "What is half of 8?", "4"),
      q("c", "What is half of 10?", "5"),
    ];
    const y2 = gateSheet({ type: "exit-ticket", yearGroup: "Year 2", blocks });
    expect(y2.blocks.filter((b) => b.type === "question").map((b) => b.id)).toEqual(["b", "c"]);
    expect(y2.findings[0]?.check).toBe("sheet-gate:spoken-task");
    const y9 = gateSheet({ type: "exit-ticket", yearGroup: "Year 9", blocks });
    expect(y9.blocks.filter((b) => b.type === "question")).toHaveLength(3);
  });

  test("multiple choice with two keyed options, and a placeholder paragraph, are dropped", () => {
    const result = gateSheet({
      type: "exit-ticket",
      yearGroup: "Year 9",
      blocks: [
        {
          id: "m",
          type: "multiple-choice",
          doc: docFromText("Which bank erodes?"),
          options: [
            { id: "1", text: "Outer", correct: true },
            { id: "2", text: "Inner", correct: true },
          ],
        },
        {
          id: "p",
          type: "paragraph",
          doc: docFromText("Generation writes this part: a fourth question."),
        },
        q("a", "What is erosion?", "Wearing away."),
        q("b", "What is deposition?", "Dropping sediment."),
      ],
    });
    expect(result.findings.map((f) => f.check)).toEqual([
      "sheet-gate:not-one-keyed",
      "sheet-gate:placeholder",
    ]);
    expect(result.blocks.map((b) => b.id)).toEqual(["a", "b"]);
    const first = result.blocks[0];
    expect(first?.type === "question" && richDocToPlainText(first.doc)).toBe("What is erosion?");
  });
});
