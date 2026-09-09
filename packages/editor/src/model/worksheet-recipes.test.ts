import { describe, expect, test } from "bun:test";
import {
  LessonFactsSchema,
  WORD_SEARCH_MAX_SIZE,
  WorksheetBlockSchema,
} from "@tj/domain/documents";
import { buildWordSearch } from "../worksheet/word-search";
import { DEMO_LESSON_FACTS } from "./demo-facts";
import { numberQuestions } from "./worksheet-factories";
import {
  JOBS,
  PLACEHOLDER_QUESTION,
  recipeById,
  WORKSHEET_RECIPES,
  type WorksheetRecipe,
} from "./worksheet-recipes";

const facts = DEMO_LESSON_FACTS;
const shape = (recipe: WorksheetRecipe, withFacts: boolean) =>
  recipe.build(withFacts ? facts : undefined).map((b) => b.type);
const collapse = (types: string[]) => types.filter((t, i) => i === 0 || types[i - 1] !== t);

describe("demo facts", () => {
  test("the water cycle facts satisfy LessonFactsSchema and add up to the hour", () => {
    expect(LessonFactsSchema.safeParse(facts).success).toBe(true);
    expect(facts.objectives.length).toBe(3);
    expect(facts.vocabulary.length).toBe(6);
    expect(facts.workedExamples.length).toBe(2);
    expect(facts.questions.length).toBe(5);
    expect(facts.misconceptions.length).toBe(4);
    expect(facts.outline.reduce((sum, e) => sum + e.minutes, 0)).toBe(facts.durationMin);
  });
});

describe("worksheet recipes", () => {
  test("nine recipes with distinct ids, a line, a minutes range and known jobs", () => {
    expect(WORKSHEET_RECIPES.length).toBe(9);
    expect(new Set(WORKSHEET_RECIPES.map((r) => r.id)).size).toBe(9);
    const jobs = new Set(JOBS.map((j) => j.id));
    for (const r of WORKSHEET_RECIPES) {
      expect(r.line.length).toBeGreaterThan(0);
      expect(r.minutes[0]).toBeLessThanOrEqual(r.minutes[1]);
      expect(r.jobs.length).toBeGreaterThan(0);
      for (const job of r.jobs) expect(jobs.has(job)).toBe(true);
    }
    expect(recipeById("matching")?.name).toBe("Matching");
    expect(recipeById("nope")).toBeUndefined();
  });

  test.each(WORKSHEET_RECIPES.map((r) => [r.id, r] as const))(
    "%s: every block is valid, cites facts when built from them, and is bare without",
    (_id, recipe) => {
      const built = recipe.build(facts);
      expect(built.length).toBeGreaterThan(0);
      for (const block of built) {
        expect(WorksheetBlockSchema.safeParse(block).success).toBe(true);
        expect(block.generatedFrom?.factRefs.length ?? 0).toBeGreaterThan(0);
        for (const ref of block.generatedFrom?.factRefs ?? []) expect(ref).toMatch(/^[a-z]\d+$/);
      }
      const bare = recipe.build();
      // The same shapes: the block types in the same order, with runs of one type collapsed (a
      // lesson with six terms makes six gap sentences; the placeholder build makes two).
      expect(collapse(bare.map((b) => b.type))).toEqual(collapse(built.map((b) => b.type)));
      for (const block of bare) {
        expect(WorksheetBlockSchema.safeParse(block).success).toBe(true);
        expect(block.generatedFrom).toBeUndefined();
      }
      // Ids are minted per build, so two sheets never share a block.
      const again = recipe.build(facts);
      expect(new Set([...built, ...again].map((b) => b.id)).size).toBe(built.length * 2);
    },
  );

  test("acceptance 1: matching from the water cycle facts", () => {
    const built = recipeById("matching")?.build(facts) ?? [];
    const matching = built.find((b) => b.type === "matching");
    if (matching?.type !== "matching") throw new Error("no matching block");
    expect(matching.pairs.length).toBe(6);
    expect(matching.pairs[0]).toMatchObject({ left: "evaporation" });
    expect(matching.pairs[0]?.right).toBe(facts.vocabulary[0]?.definition);
    const bank = built.find((b) => b.type === "word-bank");
    if (bank?.type !== "word-bank") throw new Error("no word bank");
    expect(bank.words).toEqual(facts.vocabulary.map((v) => v.term));
    for (const block of built) {
      expect(block.generatedFrom?.factRefs).toEqual(
        expect.arrayContaining(matching.generatedFrom?.factRefs ?? []),
      );
    }
  });

  test("acceptance 2: no facts gives the same shapes with placeholder copy", () => {
    expect(shape(recipeById("exit-ticket") as WorksheetRecipe, false)).toEqual([
      "question",
      "question",
      "question",
      "answer-box",
      "paragraph",
    ]);
    const exam = recipeById("exam-style")?.build() ?? [];
    const questions = exam.filter((b) => b.type === "question");
    expect(questions.length).toBe(6);
    for (const q of questions) {
      expect(JSON.stringify(q)).toContain(PLACEHOLDER_QUESTION);
      expect(q.generatedFrom).toBeUndefined();
    }
    expect(exam.at(-1)?.type).toBe("page-break");
  });

  test("exit ticket: three questions from the facts and the answer box", () => {
    const built = recipeById("exit-ticket")?.build(facts) ?? [];
    expect(shape(recipeById("exit-ticket") as WorksheetRecipe, true)).toEqual([
      "question",
      "question",
      "question",
      "answer-box",
      "paragraph",
    ]);
    expect(built.slice(0, 3).map((b) => b.generatedFrom?.factRefs)).toEqual([
      ["q1"],
      ["q2"],
      ["q3"],
    ]);
    const box = built[3];
    expect(box?.type === "answer-box" && box.label).toBe("One thing I learned");
    const q = built[0];
    expect(q?.type === "question" && q.answer).toBe(facts.questions[0]?.answer);
  });

  test("knowledge check: two questions then the placeholder naming the three items", () => {
    const built = recipeById("knowledge-check")?.build(facts) ?? [];
    expect(built.map((b) => b.type)).toEqual(["instructions", "question", "question", "paragraph"]);
    const last = built.at(-1);
    expect(JSON.stringify(last)).toContain("three multiple choice items");
    expect(last?.generatedFrom?.factRefs).toEqual(expect.arrayContaining(["m1", "m4", "q1", "q2"]));
  });

  test("misconception check: each misconception false, as many definitions true, then explain", () => {
    const built = recipeById("misconception-check")?.build(facts) ?? [];
    const claims = built.filter((b) => b.type === "multiple-choice");
    expect(claims.length).toBe(8);
    for (const c of claims.slice(0, 4)) {
      if (c.type !== "multiple-choice") throw new Error("claim");
      expect(c.options.map((o) => [o.text, o.correct])).toEqual([
        ["True", false],
        ["False", true],
      ]);
      expect(c.generatedFrom?.factRefs[0]).toMatch(/^m\d$/);
    }
    for (const c of claims.slice(4)) {
      if (c.type !== "multiple-choice") throw new Error("claim");
      expect(c.options.find((o) => o.correct)?.text).toBe("True");
      expect(c.generatedFrom?.factRefs[0]).toMatch(/^v\d$/);
    }
    expect(JSON.stringify(claims[4])).toContain(
      "Evaporation is liquid water turning into water vapour.",
    );
    const explain = built.find((b) => b.type === "question");
    expect(explain?.type === "question" && explain.marks).toBe(2);
  });

  test("cloze: one gap per term with the term as the answer, and the bank", () => {
    const built = recipeById("cloze")?.build(facts) ?? [];
    const gaps = built.filter((b) => b.type === "fill-gap");
    expect(gaps.length).toBe(6);
    for (const [i, g] of gaps.entries()) {
      if (g.type !== "fill-gap") throw new Error("gap");
      expect(g.gaps.length).toBe(1);
      expect(g.gaps[0]?.answer).toBe(facts.vocabulary[i]?.term as string);
      expect(JSON.stringify(g.doc)).toContain(`[[gap:${g.gaps[0]?.id}]]`);
    }
    const bank = built.find((b) => b.type === "word-bank");
    expect(bank?.type === "word-bank" && bank.words.length).toBe(6);
  });

  test("word search: the terms in a seeded grid sized to the longest, the bank shown, no placeholder", () => {
    const built = recipeById("word-search")?.build(facts) ?? [];
    expect(built.map((b) => b.type)).toEqual(["instructions", "word-search"]);
    const grid = built[1];
    if (grid?.type !== "word-search") throw new Error("grid");
    expect(grid.words).toEqual(facts.vocabulary.map((v) => v.term));
    // "precipitation" and "transpiration" are 13 letters: the grid grows past the 12 default.
    expect(grid.size).toBe(13);
    expect(grid.seed).toBe(1);
    expect(grid.showWordBank).toBe(true);
    // Every term is in the built grid: nothing dropped, nothing overlong.
    const result = buildWordSearch(grid);
    expect(result.error).toBeNull();
    expect(result.grid?.placements.length).toBe(6);
    expect(result.grid?.unplaced).toEqual([]);
    expect(JSON.stringify(built[0])).not.toContain("Not in the grid");
  });

  test("word search: a term longer than the largest grid stays out and is named on the sheet", () => {
    const longFacts: typeof facts = {
      ...facts,
      vocabulary: [
        ...facts.vocabulary,
        { id: "v7", term: "photosynthesising", definition: "Seventeen letters, one over the cap." },
      ],
    };
    const built = recipeById("word-search")?.build(longFacts) ?? [];
    const grid = built[1];
    if (grid?.type !== "word-search") throw new Error("grid");
    // Sized to the longest term that fits (13), not to the one left out.
    expect(grid.size).toBe(13);
    expect(grid.size).toBeLessThanOrEqual(WORD_SEARCH_MAX_SIZE);
    expect(grid.words).not.toContain("photosynthesising");
    expect(grid.words.length).toBe(6);
    expect(grid.generatedFrom?.factRefs).not.toContain("v7");
    expect(JSON.stringify(built[0])).toContain("Not in the grid: photosynthesising.");
    expect(built[0]?.generatedFrom?.factRefs).toContain("v7");
    expect(buildWordSearch(grid).error).toBeNull();
    // Short terms keep the default side.
    const short = recipeById("word-search")?.build({
      ...facts,
      vocabulary: facts.vocabulary.slice(0, 2),
    })?.[1];
    expect(short?.type === "word-search" && short.size).toBe(12);
  });

  test("worked example: fewer than three lesson questions leaves the honest placeholder", () => {
    const built =
      recipeById("worked-example")?.build({ ...facts, questions: facts.questions.slice(0, 1) }) ??
      [];
    expect(built.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "question",
      "question",
      "question",
      "paragraph",
    ]);
    expect(JSON.stringify(built[4])).toContain(PLACEHOLDER_QUESTION);
    expect(JSON.stringify(built.at(-1))).toContain("remaining Now try questions");
    expect(built.at(-1)?.generatedFrom?.factRefs).toEqual(expect.arrayContaining(["w1", "q1"]));
    // With three or more, nothing is left for generation.
    expect(recipeById("worked-example")?.build(facts).at(-1)?.type).toBe("question");
  });

  test("worked example: the problem and steps as one paragraph, then three to try", () => {
    const built = recipeById("worked-example")?.build(facts) ?? [];
    expect(built.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "question",
      "question",
      "question",
    ]);
    const text = JSON.stringify(built[1]);
    expect(text).toContain("Problem: A puddle");
    expect(text).toContain("Step 3:");
    expect(built[1]?.generatedFrom?.factRefs).toEqual(["w1"]);
    const marks = numberQuestions(built)
      .filter((b) => b.type === "question")
      .map((b) => (b.type === "question" ? b.marks : 0));
    expect(marks).toEqual([1, 2, 3]);
  });

  test("reading: heading, instructions, the passage placeholder, four rising questions", () => {
    const built = recipeById("reading")?.build(facts) ?? [];
    expect(built.map((b) => b.type)).toEqual([
      "heading",
      "instructions",
      "paragraph",
      "question",
      "question",
      "question",
      "question",
    ]);
    expect(JSON.stringify(built[2])).toContain("the passage");
    const marks = built.flatMap((b) => (b.type === "question" ? [b.marks] : []));
    expect(marks).toEqual([1, 2, 3, 4]);
  });

  test("exam style: five lesson questions plus one placeholder make six, then a page break", () => {
    const built = recipeById("exam-style")?.build(facts) ?? [];
    const questions = built.filter((b) => b.type === "question");
    expect(questions.length).toBe(6);
    expect(questions.slice(0, 5).map((q) => q.generatedFrom?.factRefs)).toEqual([
      ["q1"],
      ["q2"],
      ["q3"],
      ["q4"],
      ["q5"],
    ]);
    expect(JSON.stringify(questions[5])).toContain(PLACEHOLDER_QUESTION);
    expect(built.at(-1)?.type).toBe("page-break");
    expect(built.flatMap((b) => (b.type === "question" ? [b.marks] : []))).toEqual([
      1, 1, 2, 2, 3, 4,
    ]);
  });
});
