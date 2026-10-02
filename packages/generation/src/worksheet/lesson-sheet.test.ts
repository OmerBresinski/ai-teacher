import { describe, expect, test } from "bun:test";
import {
  type Lesson,
  parseLesson,
  parseWorksheet,
  richDocToPlainText,
  type Worksheet,
  type WorksheetBlock,
} from "@tj/domain/documents";
import {
  emptyBlocks,
  isPlaceholder,
  PLACEHOLDER_QUESTION,
  recipeForFacts,
  resolveRecipe,
} from "@tj/slides";
import y1 from "../fixtures/lessons/y1-animals.lesson.json";
import y5 from "../fixtures/lessons/y5-fractions.lesson.json";
import y11 from "../fixtures/lessons/y11-rates.lesson.json";
import y13 from "../fixtures/lessons/y13-freud.lesson.json";
import { planFromObjectives } from "../planner/plan-pipeline";
import { labAi, romansLesson } from "../planner/testing";
import { generateWorksheetLessonPrompt } from "../prompts";
import { recordingDeps, scriptedWorksheetAi } from "../testing";
import { checkWorksheet, emptyBlockFindings } from "./check";
import { lessonCycles, normaliseStem, slideQuestionStems } from "./cycles";
import { fillFrame } from "./fill";
import { ASKS_FOR_EXAM, optionCountFor, worksheetFit } from "./fit";
import { buildFrame } from "./frame";
import { lessonSheetOutputTokens } from "./lesson-sheet";
import { COMMAND_WORDS, lessonSheetSchemaFor } from "./lesson-specs";

/*
 * TEACH-86 acceptance rows 1–7 on the fake AI: "Follows the lesson" built from the finished
 * lesson's slides (plan-write output from the J1v lab run, `fixtures/lessons/`) and from an
 * objectives-first plan with no slides yet (the outline stands in).
 */

const lessonOf = (raw: unknown): Lesson => parseLesson(raw);
const text = (b: WorksheetBlock) => ("doc" in b && b.doc ? richDocToPlainText(b.doc) : "");

async function sheetFor(
  lesson: Lesson,
  options: { recipeId?: Parameters<typeof resolveRecipe>[0]; exitTicket?: boolean } = {},
) {
  const facts = lesson.facts;
  if (!facts) throw new Error("fixture has no facts");
  const requested = resolveRecipe(options.recipeId ?? "auto", facts);
  const { recipe, fellBackFrom } = recipeForFacts(requested, facts);
  const deps = recordingDeps(scriptedWorksheetAi());
  const frame = buildFrame(
    { recipe, facts, lesson, worksheetId: "ws-1", practiceMinutes: 20 },
    {
      now: () => new Date("2026-10-02T10:00:00.000Z"),
    },
  );
  const filled = await fillFrame(
    { ...frame, recipe, lesson, facts, practiceMinutes: 20, exitTicket: options.exitTicket },
    deps,
  );
  const sheet: Worksheet = { ...filled.worksheet };
  return { recipe, fellBackFrom, sheet, filled, deps };
}

/** The sheet cut at its task headings: [heading text, blocks after it]. */
function tasksOf(sheet: Worksheet): { title: string; blocks: WorksheetBlock[] }[] {
  const tasks: { title: string; blocks: WorksheetBlock[] }[] = [];
  for (const block of sheet.blocks) {
    if (block.type === "heading") tasks.push({ title: text(block), blocks: [] });
    else tasks.at(-1)?.blocks.push(block);
  }
  return tasks;
}

const TASK_TYPES = new Set(["question", "multiple-choice", "fill-gap", "matching", "word-bank"]);
const supported = (b: WorksheetBlock) =>
  ["fill-gap", "word-bank", "multiple-choice", "matching"].includes(b.type) ||
  (b.type === "question" && b.answerLines < 3);
const open = (b: WorksheetBlock) => b.type === "question" && b.answerLines >= 3;

describe("lessonCycles", () => {
  test("plan-write slides: teaching up to and including its checks and practice, in order", () => {
    const cycles = lessonCycles(lessonOf(y5));
    expect(cycles.map((c) => c.slides.map((s) => s.part[0]).join(""))).toEqual(["ttc", "tttcp"]);
    expect(cycles[0]?.objectiveIds).toEqual(["o1"]);
    expect(cycles[0]?.title).toBe("The denominator sets the equal parts");
    // Title, objectives and the retrieval starter belong to no cycle.
    const ids = new Set(cycles.flatMap((c) => c.slides.map((s) => s.id)));
    const y5Lesson = lessonOf(y5);
    expect(ids.has(y5Lesson.slides[0]?.id ?? "")).toBe(false);
    expect(ids.has(y5Lesson.slides[2]?.id ?? "")).toBe(false);
  });

  test("no slides yet: the outline stands in; no outline either: one cycle per objective", () => {
    const lesson = lessonOf(y1);
    const outlineOnly = lessonCycles({ ...lesson, slides: [] });
    expect(outlineOnly).toHaveLength(3);
    const facts = lesson.facts;
    if (!facts) throw new Error("no facts");
    const bare = lessonCycles({ ...lesson, slides: [], facts: { ...facts, outline: [] } });
    expect(bare.map((c) => c.objectiveIds)).toEqual([["o1"], ["o2"], ["o3"]]);
  });
});

describe("Follows the lesson (TEACH-86)", () => {
  test("row 1: objectives-first lesson, 3 objectives: recipe lesson, tasks in cycle order, supported before stretch", async () => {
    const planned = await planFromObjectives({ lesson: romansLesson() }, recordingDeps(labAi()), {
      verify: false,
    });
    const lesson = planned.lesson;
    expect(lesson.facts?.objectives).toHaveLength(3);
    const { recipe, sheet, filled } = await sheetFor(lesson);
    expect(recipe.id).toBe("lesson");
    expect(filled.promptVersion).toBe(generateWorksheetLessonPrompt.version);
    const cycles = lessonCycles(lesson);
    expect(cycles.length).toBeGreaterThanOrEqual(2);
    // The Romans outline closes on an exit-ticket slide (ruling 141), so the sheet ends with one.
    const all = tasksOf(sheet);
    expect(all.at(-1)?.title).toBe("Exit ticket");
    const tasks = all.slice(0, -1);
    expect(tasks.map((t) => t.title)).toEqual(
      cycles.map((c, i) => `Task ${"ABCDEFGH"[i]}: ${c.title}`),
    );
    for (const task of tasks) {
      const work = task.blocks.filter((b) => TASK_TYPES.has(b.type));
      const firstSupported = work.findIndex(supported);
      const lastOpen = work.map(open).lastIndexOf(true);
      expect(firstSupported).toBeGreaterThanOrEqual(0);
      expect(lastOpen).toBeGreaterThan(firstSupported);
    }
    expect(() => parseWorksheet(sheet)).not.toThrow();
  });

  test("row 1: the slides' cycles under plan-write, in lesson order", async () => {
    const lesson = lessonOf(y11);
    const { sheet } = await sheetFor(lesson);
    expect(tasksOf(sheet).map((t) => t.title)).toEqual([
      "Task A: Gas production reveals reaction rate",
      "Task B: Successful collisions control reaction rate",
      "Task C: Catalysts lower activation energy",
    ]);
  });

  test("row 2: plan-write facts (no vocabulary, no questions) still give a full sheet", async () => {
    const lesson = lessonOf(y1);
    const facts = lesson.facts;
    if (!facts) throw new Error("no facts");
    const thin = {
      ...lesson,
      facts: { ...facts, vocabulary: [], questions: [], workedExamples: [] },
    };
    const { sheet } = await sheetFor(thin);
    expect(sheet.blocks.length).toBeGreaterThan(6);
    expect(sheet.blocks.some(isPlaceholder)).toBe(false);
    expect(emptyBlocks(sheet.blocks)).toEqual([]);
    expect(sheet.blocks.map(text).join("\n")).not.toContain(PLACEHOLDER_QUESTION);
  });

  test("row 3: KS4 chemistry gets marked items with a command word and a mark scheme; Y5 gets none", async () => {
    const ks4 = (await sheetFor(lessonOf(y11))).sheet;
    const marked = ks4.blocks.filter(
      (b): b is Extract<WorksheetBlock, { type: "question" }> =>
        b.type === "question" && b.marks !== undefined,
    );
    expect(marked.length).toBeGreaterThan(0);
    for (const q of marked) {
      expect(COMMAND_WORDS.some((w) => text(q).toLowerCase().startsWith(w))).toBe(true);
      expect(q.answer?.startsWith("Mark scheme:")).toBe(true);
    }
    expect(ks4.showMarks).toBe(true);
    const y5Sheet = (await sheetFor(lessonOf(y5))).sheet;
    expect(y5Sheet.blocks.some((b) => b.type === "question" && b.marks !== undefined)).toBe(false);
    expect(y5Sheet.showMarks).toBeUndefined();
  });

  test("row 3: marks a model writes below KS4 are dropped from the sheet", async () => {
    const lesson = lessonOf(y5);
    const answer = {
      tasks: lessonCycles(lesson).map((c) => ({
        cycle: c.index,
        title: c.title,
        instruction: "Work out each answer.",
        supported: [
          {
            type: "question",
            text: "What is 1/4 of 20?",
            answer: "5",
            answerLines: 1,
            factRefs: [],
          },
        ],
        stretch: [
          {
            type: "question",
            text: "Explain how you find 3/4 of 24.",
            answer: "Divide 24 by 4 to get 6.\nMultiply 6 by 3 to get 18.",
            answerLines: 4,
            marks: 3,
            factRefs: [],
          },
        ],
      })),
      exitTicket: null,
    };
    const facts = lesson.facts;
    if (!facts) throw new Error("no facts");
    const recipe = resolveRecipe("auto", facts);
    const frame = buildFrame(
      { recipe, facts, lesson, worksheetId: "w", practiceMinutes: 20 },
      {
        now: () => new Date(0),
      },
    );
    const deps = recordingDeps(scriptedWorksheetAi({ fill: JSON.stringify(answer) }));
    // The scripted answer has `tasks`, so the router hands it to the lesson call.
    const result = await fillFrame({ ...frame, recipe, lesson, facts, practiceMinutes: 20 }, deps);
    expect(
      result.worksheet.blocks.some((b) => b.type === "question" && b.marks !== undefined),
    ).toBe(false);
  });

  test("row 4: Y1 gets shorter items and a word bank; Y13 longer items and none", async () => {
    const load = (sheet: Worksheet) => {
      const items = sheet.blocks.filter((b) => TASK_TYPES.has(b.type) && b.type !== "word-bank");
      const words = items.map((b) => text(b).split(/\s+/).filter(Boolean).length);
      return {
        wordsPerItem: words.reduce((a, b) => a + b, 0) / items.length,
        wordBanks: sheet.blocks.filter((b) => b.type === "word-bank").length,
      };
    };
    const young = await sheetFor(lessonOf(y1));
    const old = await sheetFor(lessonOf(y13));
    // The call is told who it is for; the fake writer stands in for the model's fitting.
    expect(young.deps.ai.calls[0]?.promptText).toContain("key stage: ks1");
    expect(old.deps.ai.calls[0]?.promptText).toContain("key stage: post16");
    expect(load(young.sheet).wordBanks).toBeGreaterThan(0);
    expect(load(old.sheet).wordBanks).toBe(0);
    expect(load(young.sheet).wordsPerItem).toBeLessThan(load(old.sheet).wordsPerItem);
  });

  test("row 5: the exit ticket closes the sheet with 1–3 questions, none a slide question", async () => {
    const lesson = lessonOf(y11);
    const { sheet } = await sheetFor(lesson, { exitTicket: true });
    const tasks = tasksOf(sheet);
    const last = tasks.at(-1);
    expect(last?.title).toBe("Exit ticket");
    const questions = (last?.blocks ?? []).filter((b) => TASK_TYPES.has(b.type));
    expect(questions.length).toBeGreaterThanOrEqual(1);
    expect(questions.length).toBeLessThanOrEqual(3);
    const stems = new Set(slideQuestionStems(lesson, lessonCycles(lesson)));
    for (const q of questions) expect(stems.has(normaliseStem(text(q)))).toBe(false);
  });

  test("row 5: an exit question that repeats a slide question is an editorial miss", () => {
    const schema = lessonSheetSchemaFor({
      cycles: 1,
      examStyle: false,
      exitTicket: true,
      slideStems: ["what is 1/5 of 30 cakes"],
    });
    const result = schema.safeParse({
      tasks: [
        {
          cycle: 1,
          title: "Fractions",
          instruction: "Fill the gaps.",
          supported: [{ type: "word-bank", words: ["half", "third", "quarter"], factRefs: [] }],
          stretch: [
            {
              type: "question",
              text: "Explain why 2/3 of 30 is 20.",
              answer: "30 ÷ 3 = 10\n10 × 2 = 20",
              answerLines: 4,
              factRefs: [],
            },
          ],
        },
      ],
      exitTicket: [
        {
          type: "question",
          text: "What is 1/5 of 30 cakes?",
          answer: "6",
          answerLines: 1,
          factRefs: [],
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("repeats a slide question");
  });

  test("shape: tasks out of cycle order, or an exit ticket nobody asked for, fail the call", () => {
    const task = (cycle: number) => ({
      cycle,
      title: "T",
      instruction: "Do it.",
      supported: [{ type: "word-bank", words: ["a1", "b2", "c3"], factRefs: [] }],
      stretch: [
        { type: "question", text: "Why?", answer: "One\nTwo", answerLines: 4, factRefs: [] },
      ],
    });
    const soft = lessonSheetSchemaFor(
      { cycles: 2, examStyle: false, exitTicket: false, slideStems: [] },
      { soft: true },
    );
    expect(soft.safeParse({ tasks: [task(2), task(1)], exitTicket: null }).success).toBe(false);
    expect(soft.safeParse({ tasks: [task(1), task(3)], exitTicket: null }).success).toBe(false);
    expect(
      soft.safeParse({
        tasks: [task(1), task(2)],
        exitTicket: [{ type: "question", text: "Q?", answer: "A", answerLines: 1, factRefs: [] }],
      }).success,
    ).toBe(false);
    expect(soft.safeParse({ tasks: [task(1), task(2)], exitTicket: null }).success).toBe(true);
  });

  test("row 6: every question has an answer; open tasks carry 2–3 model points and room to write them", async () => {
    for (const raw of [y1, y5, y11, y13]) {
      const { sheet } = await sheetFor(lessonOf(raw), { exitTicket: true });
      expect(sheet.includeAnswerKey).toBe(true);
      for (const block of sheet.blocks) {
        if (block.type === "question") expect(block.answer?.trim()).toBeTruthy();
        if (block.type === "fill-gap") expect(block.gaps.every((g) => g.answer.trim())).toBe(true);
        if (block.type === "question" && block.answerLines >= 3) {
          const lines = (block.answer ?? "").split("\n");
          expect(["You might have suggested:", "Mark scheme:"]).toContain(lines[0] ?? "");
          const points = lines.slice(1);
          expect(points.length).toBeGreaterThanOrEqual(2);
          expect(block.answerLines).toBeGreaterThanOrEqual(Math.min(6, points.length * 2));
        }
      }
    }
  });

  test("row 7: Cloze on a lesson with no vocabulary falls back to lesson, saying why", async () => {
    const { recipe, fellBackFrom, sheet } = await sheetFor(lessonOf(y5), { recipeId: "cloze" });
    expect(recipe.id).toBe("lesson");
    expect(fellBackFrom?.recipeId).toBe("cloze");
    expect(fellBackFrom?.reasons.join(" ")).toContain("word bank");
    expect(emptyBlocks(sheet.blocks)).toEqual([]);
  });
});

describe("empty-block check (FR 6)", () => {
  test("an empty word bank, a thin matching, a bare word search and the placeholder question are errors", () => {
    const blocks: WorksheetBlock[] = [
      { id: "wb", type: "word-bank", words: [] },
      { id: "m", type: "matching", pairs: [{ id: "p", left: "a", right: "b" }] },
      {
        id: "ws",
        type: "word-search",
        words: [],
        size: 10,
        directions: "across-down",
        seed: 1,
        showWordBank: true,
      },
      {
        id: "q",
        type: "question",
        doc: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: PLACEHOLDER_QUESTION }] }],
        },
        answerLines: 2,
      },
    ];
    const findings = emptyBlockFindings({ blocks });
    expect(findings.map((f) => f.target.blockId)).toEqual(["wb", "m", "ws", "q"]);
    expect(findings.every((f) => f.severity === "error" && f.check === "empty-block")).toBe(true);
  });

  test("the check step runs on a lesson sheet and leaves no empty-block error", async () => {
    const lesson = lessonOf(y11);
    const { sheet, deps } = await sheetFor(lesson);
    const checked = await checkWorksheet(
      { lesson, worksheet: sheet, practiceMinutes: 20, findings: [] },
      deps,
    );
    expect(checked.findings.filter((f) => f.check === "empty-block")).toEqual([]);
    expect(checked.worksheet.blocks.length).toBe(sheet.blocks.length);
  });
});

describe("TEACH-86 review fixes", () => {
  const task = (stretch: unknown[], supported: unknown[] = []) => ({
    cycle: 1,
    title: "Rates",
    instruction: "Fill the gaps, then answer.",
    supported: [
      { type: "word-bank", words: ["rate", "time", "volume"], factRefs: [] },
      ...supported,
    ],
    stretch,
  });
  const openQ = {
    type: "question",
    text: "Why does rate fall?",
    answer: "Fewer particles\nFewer collisions",
    answerLines: 4,
    factRefs: [],
  };
  const issues = (schema: ReturnType<typeof lessonSheetSchemaFor>, value: unknown) =>
    JSON.stringify(schema.safeParse(value).error?.issues ?? []);

  test("#1: 'examples' in a Year 5 brief does not turn on exam style; 'GCSE exam practice' does", () => {
    const lesson = lessonOf(y5);
    const brief = { topic: "Fractions of amounts with worked examples", durationMin: 60 };
    expect(worksheetFit({ ...lesson, brief }).examStyle).toBe(false);
    expect(
      worksheetFit({ ...lesson, brief: { ...brief, classContext: { notes: "examine each step" } } })
        .examStyle,
    ).toBe(false);
    expect(
      worksheetFit({ ...lesson, brief: { ...brief, answers: { q1: "GCSE exam practice please" } } })
        .examStyle,
    ).toBe(true);
    expect(ASKS_FOR_EXAM.test("past papers")).toBe(true);
    expect(ASKS_FOR_EXAM.test("examples")).toBe(false);
  });

  test("#2: a KS4 sheet with no marked item is an editorial miss; one marked item clears it", () => {
    const schema = lessonSheetSchemaFor({
      cycles: 1,
      examStyle: true,
      exitTicket: false,
      slideStems: [],
    });
    expect(issues(schema, { tasks: [task([openQ])], exitTicket: null })).toContain("sits exams");
    const marked = { ...openQ, text: "Explain why the rate falls.", marks: 2 };
    expect(schema.safeParse({ tasks: [task([marked])], exitTicket: null }).success).toBe(true);
  });

  test("#2: a 1-mark item's mark scheme may be one point", () => {
    const schema = lessonSheetSchemaFor({
      cycles: 1,
      examStyle: true,
      exitTicket: false,
      slideStems: [],
    });
    const oneMark = { ...openQ, text: "State the unit of rate.", answer: "cm³/s", marks: 1 };
    expect(schema.safeParse({ tasks: [task([oneMark])], exitTicket: null }).success).toBe(true);
  });

  test("#6: Years 1–4 take three options, Year 5 up four (ruling 147)", () => {
    expect(optionCountFor("ks1", "Year 1")).toBe(3);
    expect(optionCountFor("ks2", "Year 4")).toBe(3);
    expect(optionCountFor("ks2", "Year 5")).toBe(4);
    expect(optionCountFor("ks4", "Year 11")).toBe(4);
    expect(worksheetFit(lessonOf(y1)).optionCount).toBe(3);
    const mc = (n: number) => ({
      type: "multiple-choice",
      text: "Which is the young of a hen?",
      options: ["chick", "calf", "lamb", "foal"]
        .slice(0, n)
        .map((text, i) => ({ text, correct: i === 0 })),
      factRefs: [],
    });
    const young = lessonSheetSchemaFor({
      cycles: 1,
      examStyle: false,
      exitTicket: false,
      slideStems: [],
      optionCount: 3,
    });
    expect(young.safeParse({ tasks: [task([openQ], [mc(3)])], exitTicket: null }).success).toBe(
      true,
    );
    expect(issues(young, { tasks: [task([openQ], [mc(4)])], exitTicket: null })).toContain(
      "has 3 options",
    );
    const older = lessonSheetSchemaFor({
      cycles: 1,
      examStyle: false,
      exitTicket: false,
      slideStems: [],
    });
    expect(issues(older, { tasks: [task([openQ], [mc(3)])], exitTicket: null })).toContain(
      "has 4 options",
    );
  });

  test("#5: the teacher's exit-ticket choice wins; no choice keeps the slides' default", async () => {
    const planned = await planFromObjectives({ lesson: romansLesson() }, recordingDeps(labAi()), {
      verify: false,
    });
    const headings = (s: Worksheet) => tasksOf(s).map((t) => t.title);
    expect(headings((await sheetFor(planned.lesson)).sheet)).toContain("Exit ticket");
    expect(headings((await sheetFor(planned.lesson, { exitTicket: false })).sheet)).not.toContain(
      "Exit ticket",
    );
    expect(headings((await sheetFor(lessonOf(y5))).sheet)).not.toContain("Exit ticket");
    expect(headings((await sheetFor(lessonOf(y5), { exitTicket: true })).sheet)).toContain(
      "Exit ticket",
    );
  });

  test("#3: the output cap grows with the cycles", () => {
    expect(lessonSheetOutputTokens(2, false)).toBeLessThan(lessonSheetOutputTokens(5, true));
    expect(lessonSheetOutputTokens(40, true)).toBe(16000);
  });
});
