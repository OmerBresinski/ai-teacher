import { describe, expect, test } from "bun:test";
import { parseWorksheet } from "@tj/domain/documents";
import { DEMO_FRACTIONS_FACTS, DEMO_LESSON_FACTS } from "./demo-facts";
import {
  createReducer,
  initialCreateState,
  previewWorksheet,
  selectedRecipe,
  suggestRecipe,
  visibleRecipes,
  worksheetFromRecipe,
} from "./worksheet-creation";
import { recipeById, WORKSHEET_RECIPES } from "./worksheet-recipes";

/*
 * The creation flow's pure half (TEACH-184): the suggestion rule, the Source → Kind reducer and
 * the sheet Continue makes from a recipe and a lesson.
 */

const lesson = {
  id: "lesson-1",
  title: "The water cycle",
  themeId: "chalk",
  subject: "Science",
  yearGroup: "Year 4",
  facts: DEMO_LESSON_FACTS,
};

describe("suggestRecipe", () => {
  test("misconceptions win, then a worked example, then Knowledge check", () => {
    expect(suggestRecipe(DEMO_LESSON_FACTS)).toBe("misconception-check");
    expect(suggestRecipe({ ...DEMO_LESSON_FACTS, misconceptions: [] })).toBe("worked-example");
    expect(suggestRecipe({ ...DEMO_LESSON_FACTS, misconceptions: [], workedExamples: [] })).toBe(
      "knowledge-check",
    );
    expect(suggestRecipe(undefined)).toBe("knowledge-check");
  });
});

describe("createReducer", () => {
  test("opens on Source, or on Kind with the lesson preselected", () => {
    expect(initialCreateState()).toEqual({
      step: "source",
      source: null,
      query: "",
      job: null,
      recipeId: null,
    });
    expect(initialCreateState("lesson-1")).toMatchObject({
      step: "kind",
      source: { kind: "lesson", lessonId: "lesson-1" },
    });
  });

  test("Continue needs a lesson; Blank never reaches Kind; Back returns to Source", () => {
    const start = initialCreateState();
    expect(createReducer(start, { type: "continue" })).toBe(start);
    const blank = createReducer(start, { type: "choose-blank" });
    expect(createReducer(blank, { type: "continue" }).step).toBe("source");
    const chosen = createReducer(blank, { type: "choose-lesson", lessonId: "lesson-1" });
    const kind = createReducer(chosen, { type: "continue" });
    expect(kind.step).toBe("kind");
    const filtered = createReducer(kind, { type: "job", job: "practise" });
    const back = createReducer(filtered, { type: "back" });
    expect(back).toMatchObject({ step: "source", job: null, recipeId: null });
    // The lesson stays chosen, so Continue returns to the same Kind.
    expect(back.source).toEqual({ kind: "lesson", lessonId: "lesson-1" });
  });

  test("a job chip that hides the chosen recipe drops it back to the suggestion", () => {
    const kind = initialCreateState("lesson-1");
    const picked = createReducer(kind, { type: "recipe", recipeId: "exam-style" });
    expect(selectedRecipe(picked, DEMO_LESSON_FACTS)?.id).toBe("exam-style");
    const practise = createReducer(picked, { type: "job", job: "practise" });
    expect(practise.recipeId).toBeNull();
    expect(visibleRecipes("practise").map((r) => r.id)).toEqual([
      "cloze",
      "matching",
      "worked-example",
    ]);
    // The suggestion is hidden by this chip too, so nothing is selected until a card is picked.
    expect(selectedRecipe(practise, DEMO_LESSON_FACTS)).toBeNull();
    const check = createReducer(kind, { type: "job", job: "check" });
    expect(selectedRecipe(check, DEMO_LESSON_FACTS)?.id).toBe("misconception-check");
    // A chip that keeps the choice keeps it.
    const kept = createReducer(picked, { type: "job", job: "assess" });
    expect(kept.recipeId).toBe("exam-style");
    // The same chip again is a no-op.
    expect(createReducer(kept, { type: "job", job: "assess" })).toBe(kept);
  });
});

describe("worksheetFromRecipe", () => {
  test("marks are on for an Assess recipe and unset for the others (UX ruling 60, TEACH-193)", () => {
    const exitTicket = recipeById("exit-ticket");
    const exam = WORKSHEET_RECIPES.find((r) => r.jobs.includes("assess"));
    if (!exitTicket || !exam) throw new Error("recipes missing");
    expect(worksheetFromRecipe(exitTicket, lesson, DEMO_LESSON_FACTS).showMarks).toBeUndefined();
    expect(worksheetFromRecipe(exam, lesson, DEMO_LESSON_FACTS).showMarks).toBe(true);
  });

  test("the frame is the sheet: numbered blocks, the lesson's header, lessonId, year, subject, theme", () => {
    const recipe = recipeById("exit-ticket");
    if (!recipe) throw new Error("no exit ticket");
    const sheet = worksheetFromRecipe(recipe, lesson, DEMO_LESSON_FACTS);
    expect(() => parseWorksheet(sheet)).not.toThrow();
    expect(sheet.title).toBe("The water cycle");
    expect(sheet.header.title).toBe("The water cycle");
    expect(sheet.header.subtitle).toBe(DEMO_LESSON_FACTS.objectives[0]?.text);
    expect(sheet.lessonId).toBe("lesson-1");
    expect(sheet.themeId).toBe("chalk");
    expect(sheet.subject).toBe("Science");
    expect(sheet.yearGroup).toBe("Year 4");
    // The instruction, three questions, the answer box and the placeholder, numbered as they print.
    expect(sheet.blocks.map((b) => b.type)).toEqual([
      "instructions",
      "question",
      "question",
      "question",
      "answer-box",
      "paragraph",
    ]);
    const first = sheet.blocks[1];
    expect(first?.type === "question" ? first.number : undefined).toBe(1);
    expect(JSON.stringify(sheet.blocks)).toContain(DEMO_LESSON_FACTS.questions[0]?.stem ?? "");
  });

  test("example facts fill the blocks but never the header of a lesson without facts", () => {
    const bare = { ...lesson, facts: undefined };
    expect(previewWorksheet(bare).header.subtitle).toBeUndefined();
    const recipe = recipeById("cloze");
    if (!recipe) throw new Error("no cloze");
    const sheet = worksheetFromRecipe(recipe, bare, DEMO_FRACTIONS_FACTS);
    expect(sheet.header.subtitle).toBeUndefined();
    expect(JSON.stringify(sheet.blocks)).toContain("numerator");
  });
});
