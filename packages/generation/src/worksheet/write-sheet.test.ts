import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { richDocToPlainText } from "@tj/domain/documents";
import { lessonDigest } from "@tj/slides/worksheet/digest";
import { answerSpace } from "@tj/slides/worksheet/exit-sheet";
import { fixtureLesson } from "@tj/slides/worksheet/fixtures";
import {
  STUB_EXAM_RATES,
  STUB_PRACTICE_HALVES,
  STUB_PRACTICE_RATES,
  STUB_PRACTICE_RIVERS,
  STUB_PRACTICE_ROMANS,
} from "../fixtures/sheet-stubs";
import {
  digestBrief,
  examMarksPlan,
  practiceCounts,
  practicePrompt,
} from "../prompts/worksheet-sheet";
import { NOTATION_KS1, PRACTICE_BAND_Y1_2, PRACTICE_SYSTEM } from "../prompts/worksheet-sheet-text";
import { recordingDeps } from "../testing";
import { StageFailure } from "../types";
import { SheetBuildFailure, writeModelSheet } from "./build";
import {
  copiesAsked,
  examFaults,
  practiceFaults,
  repeatedResults,
  workingFault,
} from "./sheet-items";
import { practiceBlocks } from "./write-sheet";

/* T7: stubbed model only (STUB CONTENT, hand-written); no paid or API call. */

const NOW = () => new Date("2026-11-11T10:00:00.000Z");
const answer = (value: unknown) => ({ text: JSON.stringify(value) });
const clone = <T>(v: T): T => structuredClone(v);
const nth = <T>(xs: readonly T[], i: number): T => {
  const v = xs[i];
  if (v === undefined) throw new Error(`no item ${i}`);
  return v;
};

async function practiceFor(
  name: "halves" | "romans" | "rivers" | "rates",
  stub: unknown,
  minutes: number,
) {
  const ai = createFakeAi({ script: [answer(stub)] });
  const deps = recordingDeps(ai);
  const lesson = fixtureLesson(name);
  const sheet = await writeModelSheet(
    { recipeId: "practice", lesson, worksheetId: "w1", now: NOW, practiceMinutes: minutes },
    deps,
  );
  return { ai, sheet };
}

const texts = (blocks: { type: string; doc?: unknown }[]) =>
  blocks.map((b) => (b.doc ? richDocToPlainText(b.doc as never) : `[${b.type}]`));

describe("prompt assembly", () => {
  test("system is type + band + notation joined with a newline (user.template.txt)", () => {
    expect(practicePrompt("Year 2").system).toBe(
      [PRACTICE_SYSTEM, PRACTICE_BAND_Y1_2, NOTATION_KS1].join("\n"),
    );
  });
  test("the user turn has the template's blocks and a SHEET line with code's counts", () => {
    const digest = lessonDigest(fixtureLesson("rates"));
    const user = practicePrompt("Year 11").user({ digest, counts: practiceCounts("Year 11", 15) });
    for (const head of [
      "THE CLASS",
      "OBJECTIVES",
      "TAUGHT SLIDES",
      "ALREADY ASKED IN THE LESSON",
      "SHEET",
    ]) {
      expect(user).toContain(`\n${head}`.trimStart());
    }
    expect(user).toContain("Write exactly 2 warm-up items, 5 core items and 1 challenge.");
    expect(user).toContain("Challenge level: as the lesson.");
    expect(user).toContain("  Answer: 3 cm³/s (working: 84 cm³ ÷ 28 s = 3 cm³/s)");
    expect(digestBrief(digest, { mistakes: true })).not.toContain("{{");
  });
  test("v2 clauses reach the assembled system text", () => {
    const y2 = practicePrompt("Year 2").system;
    const y11 = practicePrompt("Year 11").system;
    for (const clause of [
      "make no two of them the same task on new numbers",
      "No two calculations on the sheet have the same result.",
      "draw, shade, sketch, label, circle or colour",
      "Never word a question so that its answer only repeats the question back.",
      "never as a sentence with a gap to fill",
    ]) {
      expect(y2).toContain(clause);
      expect(y11).toContain(clause);
    }
    expect(y2).toContain("at least two items on the sheet are tasks of that kind");
    // Every draw verb the prompt names gets the builder's drawing box.
    for (const verb of ["draw", "shade", "sketch", "label", "circle", "colour"]) {
      expect(answerSpace(`${verb[0]?.toUpperCase()}${verb.slice(1)} it.`, undefined)).toBe("draw");
    }
    expect(y11).not.toContain("at least two items on the sheet are tasks of that kind");
  });
  test("practice counts follow D9", () => {
    expect(practiceCounts("Year 2", 10)).toEqual({ warmUp: 2, core: 3, total: 6 });
    expect(practiceCounts("Year 2", 20)).toEqual({ warmUp: 2, core: 3, total: 6 });
    expect(practiceCounts("Year 9", 10).total).toBe(6);
    expect(practiceCounts("Year 2", 15)).toEqual({ warmUp: 2, core: 3, total: 6 });
    expect(practiceCounts("Year 11", 15)).toEqual({ warmUp: 2, core: 5, total: 8 });
    expect(practiceCounts("Year 9", 20).total).toBe(10);
  });
  test("exam marks plan: 1,1,2,2,3,3,4 by default", () => {
    expect(examMarksPlan(lessonDigest(fixtureLesson("rates")))).toEqual([1, 1, 2, 2, 3, 3, 4]);
  });
});

describe("writeModelSheet: valid stub answers", () => {
  for (const [name, stub, minutes, items] of [
    ["halves", STUB_PRACTICE_HALVES, 10, 6],
    ["romans", STUB_PRACTICE_ROMANS, 15, 8],
    ["rivers", STUB_PRACTICE_RIVERS, 15, 8],
    ["rates", STUB_PRACTICE_RATES, 15, 8],
  ] as const) {
    test(`${name}: one small low-effort call, every item kept, three sections`, async () => {
      const { ai, sheet } = await practiceFor(name, stub, minutes);
      expect(ai.calls).toHaveLength(1);
      expect(ai.calls[0]?.modelClass).toBe("small");
      expect(ai.calls[0]?.context).toMatchObject({
        promptVersion: "worksheet-practice.v2",
        effort: "low",
      });
      expect(sheet.findings).toEqual([]);
      const questions = sheet.worksheet.blocks.filter((b) => b.type === "question");
      expect(questions).toHaveLength(items);
      expect(questions.every((q) => q.type === "question" && (q.answer ?? "").length > 0)).toBe(
        true,
      );
      const headings = texts(sheet.worksheet.blocks.filter((b) => b.type === "heading"));
      expect(headings).toEqual(["Warm up", "Practice", "Challenge"]);
    });
  }

  test("a calculation's key carries its working in brackets", async () => {
    const { sheet } = await practiceFor("rates", STUB_PRACTICE_RATES, 15);
    const q = sheet.worksheet.blocks.find(
      (b) => b.type === "question" && b.answer?.startsWith("5 cm³/s"),
    );
    expect(q?.type === "question" && q.answer).toBe(
      "5 cm³/s (Mean rate = gas volume ÷ time; 90 cm³ ÷ 18 s = 5 cm³/s)",
    );
  });

  test("exam practice: marks set by code, mark scheme as the key, showMarks on", async () => {
    const ai = createFakeAi({ script: [answer(STUB_EXAM_RATES)] });
    const sheet = await writeModelSheet(
      {
        recipeId: "exam-style",
        lesson: fixtureLesson("rates"),
        worksheetId: "w1",
        now: NOW,
        practiceMinutes: 30,
      },
      recordingDeps(ai),
    );
    expect(sheet.findings).toEqual([]);
    expect(sheet.worksheet.showMarks).toBe(true);
    const qs = sheet.worksheet.blocks.filter((b) => b.type === "question");
    expect(qs.map((q) => (q.type === "question" ? q.marks : 0))).toEqual([1, 1, 2, 2, 3, 3, 4]);
    expect(qs[4]?.type === "question" && qs[4].answer?.split("; ")).toHaveLength(3);
    expect(sheet.promptVersion).toBe("worksheet-exam.v1");
  });
});

describe("writeModelSheet: invalid stub answers", () => {
  test("not JSON twice: StageFailure (the worker's could-not-write)", async () => {
    const ai = createFakeAi({ script: [{ text: "Here are your questions" }, { text: "{ nope" }] });
    await expect(
      writeModelSheet(
        {
          recipeId: "practice",
          lesson: fixtureLesson("rivers"),
          worksheetId: "w1",
          now: NOW,
          practiceMinutes: 15,
        },
        recordingDeps(ai),
      ),
    ).rejects.toBeInstanceOf(StageFailure);
    expect(ai.calls).toHaveLength(2);
  });

  test("a shape miss then a valid answer: accepted on the retry", async () => {
    const bad = { warmUp: [], core: [], challenge: null };
    const ai = createFakeAi({ script: [answer(bad), answer(STUB_PRACTICE_RIVERS)] });
    const sheet = await writeModelSheet(
      {
        recipeId: "practice",
        lesson: fixtureLesson("rivers"),
        worksheetId: "w1",
        now: NOW,
        practiceMinutes: 15,
      },
      recordingDeps(ai),
    );
    expect(ai.calls).toHaveLength(2);
    expect(sheet.worksheet.blocks.filter((b) => b.type === "question")).toHaveLength(8);
  });

  test("item rule misses twice: the bad items are dropped with findings; too few fails", async () => {
    const bad = clone(STUB_PRACTICE_ROMANS);
    // Copies an already-asked question, mentions the lesson, has no answer, cites slide 99.
    bad.core[0] = {
      ...nth(bad.core, 0),
      question: "Where could soldiers live while guarding the wall?",
    };
    bad.core[1] = { ...nth(bad.core, 1), question: "Using the slides, explain what a gate did." };
    bad.core[2] = { ...nth(bad.core, 2), answer: "Answers will vary" };
    bad.core[3] = { ...nth(bad.core, 3), slides: [99] };
    const ai = createFakeAi({ script: [answer(bad), answer(bad)] });
    const run = writeModelSheet(
      {
        recipeId: "practice",
        lesson: fixtureLesson("romans"),
        worksheetId: "w1",
        now: NOW,
        practiceMinutes: 15,
      },
      recordingDeps(ai),
    );
    await expect(run).rejects.toBeInstanceOf(SheetBuildFailure);
    await run.catch((e: SheetBuildFailure) => expect(e.code).toBe("too-few-checked"));
  });

  test("one bad item: dropped, the rest ship, the finding says why", async () => {
    const bad = clone(STUB_PRACTICE_RIVERS);
    bad.core[0] = {
      ...nth(bad.core, 0),
      question: "Which erosion process is this? In the lesson notes.",
    };
    const ai = createFakeAi({ script: [answer(bad), answer(bad)] });
    const sheet = await writeModelSheet(
      {
        recipeId: "practice",
        lesson: fixtureLesson("rivers"),
        worksheetId: "w1",
        now: NOW,
        practiceMinutes: 15,
      },
      recordingDeps(ai),
    );
    expect(sheet.worksheet.blocks.filter((b) => b.type === "question")).toHaveLength(7);
    expect(sheet.findings.some((f) => f.message.includes("mentions the lesson"))).toBe(true);
  });

  test("a dropped challenge fails the sheet even with enough items", async () => {
    const bad = clone(STUB_PRACTICE_RATES);
    bad.challenge = { ...bad.challenge, working: "60 cm³ ÷ 20 s = 4 cm³/s" };
    const ai = createFakeAi({ script: [answer(bad), answer(bad)] });
    await expect(
      writeModelSheet(
        {
          recipeId: "practice",
          lesson: fixtureLesson("rates"),
          worksheetId: "w1",
          now: NOW,
          practiceMinutes: 15,
        },
        recordingDeps(ai),
      ),
    ).rejects.toBeInstanceOf(SheetBuildFailure);
  });

  test("exam: wrong marks and a short mark scheme are dropped; under 15 marks fails", async () => {
    const bad = clone(STUB_EXAM_RATES);
    bad.items[6] = { ...nth(bad.items, 6), marks: 2 };
    const ai = createFakeAi({ script: [answer(bad), answer(bad)] });
    await expect(
      writeModelSheet(
        {
          recipeId: "exam-style",
          lesson: fixtureLesson("rates"),
          worksheetId: "w1",
          now: NOW,
          practiceMinutes: 30,
        },
        recordingDeps(ai),
      ),
    ).rejects.toBeInstanceOf(SheetBuildFailure);
  });
});

describe("item rules", () => {
  const digest = lessonDigest(fixtureLesson("rates"));
  const item = (patch: object) => ({ ...nth(STUB_PRACTICE_RATES.core, 0), ...patch });
  test("the working's result must start the answer", () => {
    expect(workingFault("q", "84 ÷ 28 = 3 cm³/s", "3 cm³/s")).toBeNull();
    expect(workingFault("q", "84 ÷ 28 = 3 cm³/s", "4 cm³/s")).toContain("does not match");
    expect(workingFault("q", "84 ÷ 28", "3 cm³/s")).toContain("does not end");
  });
  test("a Year 3+ calculation without working is refused", () => {
    expect(practiceFaults(item({ working: null }), { digest })).toContain(
      "calculates but gives no working",
    );
  });
  test("a question with a gap to fill is refused (v2: no gap-fill block yet)", () => {
    expect(
      practiceFaults(item({ question: "Complete: the rate is _____ cm³/s.", working: null }), {
        digest,
      }),
    ).toContain("leaves a gap to fill in the question");
    expect(practiceFaults(item({}), { digest })).not.toContain(
      "leaves a gap to fill in the question",
    );
  });
  test("a repeated calculation result is found by index (retry-only, never dropped)", () => {
    const w = (working: string | null) => ({ working });
    expect([
      ...repeatedResults([
        w("84 ÷ 28 = 3 cm³/s"),
        w(null),
        w("45 ÷ 15 = 3 cm³/s"),
        w("72 ÷ 30 = 2.4 cm³/s"),
      ]),
    ]).toEqual([2]);
    expect(practiceFaults(item({}), { digest })).not.toContain(
      "has the same calculation result as another item",
    );
  });
  test("a kept item with a repeated result is logged, not dropped", () => {
    const out = clone(STUB_PRACTICE_RATES);
    const first = nth(out.core, 0);
    out.core[1] = { ...first, question: `${first.question} Show your method.` };
    const built = practiceBlocks(out, digest, () => "x");
    expect(built.findings.map((f) => f.check)).toContain("sheet-gate:repeated-result");
  });
  test("copy check: same words, or 80% overlap with the same numbers", () => {
    const asked = [
      "A reaction produces 84 cm³ of hydrogen in 28 seconds. Calculate its mean rate.",
    ];
    expect(
      copiesAsked(
        "A reaction produces 84 cm³ of hydrogen in 28 seconds. Calculate the mean rate.",
        asked,
      ),
    ).toBe(true);
    expect(
      copiesAsked(
        "A reaction produces 90 cm³ of hydrogen in 18 seconds. Calculate its mean rate.",
        asked,
      ),
    ).toBe(false);
  });
  test("exam: the question opens with its command word, one point per mark", () => {
    const it = nth(STUB_EXAM_RATES.items, 4);
    expect(examFaults(it, 3, { digest })).toEqual([]);
    expect(examFaults({ ...it, command: "State" }, 3, { digest })).toContain(
      "does not open with its command word State",
    );
    expect(examFaults({ ...it, markScheme: ["a"] }, 3, { digest })).toContain(
      "does not give one mark-scheme point per mark",
    );
  });
});
