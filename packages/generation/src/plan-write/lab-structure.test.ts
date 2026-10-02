import { describe, expect, test } from "bun:test";
import { streamLessonPrompt } from "../prompts/stream-lesson";
import {
  type Answer,
  decideStructure,
  type Evaluator,
  LessonStructureSchema,
  readRound1,
  skeleton,
  structureBlock,
  stubEvaluator,
} from "./lab-structure";
import { planMenu } from "./menu";

const FORMS = [
  "explain",
  "explain-callout",
  "list",
  "compare",
  "sequence",
  "photo",
  "figure",
  "diagram-slot",
  "worked-example",
  "hinge",
  "true-false",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
  "discussion",
  "starter-set",
  "check-set",
];
const ctx = (yearGroup: string, subject: string, rows = 7) => ({
  topic: "A topic",
  subject,
  yearGroup,
  rows,
  forms: FORMS,
});

/** An evaluator that answers every question with one fixed pick (or the first option). */
const fixed =
  (picks: Record<string, string | number | boolean>): Evaluator =>
  async (_s, qs) => {
    const answers: Record<string, Answer> = {};
    for (const [k, q] of Object.entries(qs)) {
      const want = picks[k];
      if (q.type === "boolean")
        answers[k] = { type: "boolean", probability: want === true ? 0.9 : 0.1 };
      else if (q.type === "score")
        answers[k] = { type: "score", score: Number(want ?? 1), probabilities: {} };
      else {
        const opts = Object.keys(q.criteria);
        const choice = typeof want === "string" && opts.includes(want) ? want : (opts[0] as string);
        answers[k] = {
          type: "choice",
          choice,
          probabilities: Object.fromEntries(
            opts.map((o, i) => [o, o === choice ? 0.6 : 0.4 / opts.length / (i + 1)]),
          ),
        };
      }
    }
    return { answers, ms: 1, costUsd: 0, inputTokens: 10 };
  };

describe("lab structure (TEACH-179)", () => {
  test("skeleton fills every row, teaches every objective, ends hinge then practise", () => {
    for (const rows of [5, 7, 8, 9, 10, 12])
      for (const objectives of [1, 2, 3] as const) {
        const s = skeleton(rows, { objectives, opening: "retrieve" });
        expect(s).toHaveLength(rows);
        expect(s.map((x) => x.slide)).toEqual(Array.from({ length: rows }, (_, i) => i + 3));
        for (let k = 1; k <= Math.min(objectives, rows); k++)
          expect(s.some((x) => x.role === "teach" && x.objective === k)).toBe(true);
        expect(s.at(-1)?.role).toBe("practise");
      }
  });

  test("stub answers always assemble into a schema-valid structure", async () => {
    for (const [y, sub] of [
      ["Year 1", "Science"],
      ["Year 9", "History"],
      ["Year 10", "Chemistry"],
      ["Year 13", "Psychology"],
    ] as const) {
      const run = await decideStructure(ctx(y, sub), stubEvaluator(), "stub");
      expect(LessonStructureSchema.safeParse(run.structure).success).toBe(true);
      expect(run.calls).toHaveLength(2);
    }
  });

  test("visuality sets the picture share; method gives a worked example per objective", async () => {
    const run = await decideStructure(
      ctx("Year 1", "Science", 7),
      fixed({ objectives: "two", visuality: 3, method: false, s4: "explain" }),
      "fixed",
    );
    const teach = run.structure.slots.filter((s) => s.role === "teach");
    expect(teach.every((s) => s.pictured)).toBe(true);
    const m = await decideStructure(
      ctx("Year 10", "Maths", 9),
      fixed({ objectives: "two", visuality: 0, method: true, examStyle: true, examMarks: 1 }),
      "fixed",
    );
    for (const k of [1, 2])
      expect(
        m.structure.slots.some(
          (s) => s.role === "teach" && s.objective === k && s.form === "worked-example",
        ),
      ).toBe(true);
    expect(m.structure.slots.find((s) => s.role === "practise")?.examItem).toEqual({ marks: 4 });
  });

  test("exam style only at KS4/KS5 (ruling 146)", () => {
    const r = readRound1(
      { examStyle: { type: "boolean", probability: 0.99 } },
      ctx("Year 8", "Maths"),
    );
    expect(r.examStyle).toBe(false);
  });

  test("no check form twice running", async () => {
    const run = await decideStructure(
      ctx("Year 9", "History", 12),
      fixed({ objectives: "three", s6: "true-false", s9: "true-false" }),
      "fixed",
    );
    const checks = run.structure.slots.filter((s) => s.role === "check").map((s) => s.form);
    for (let i = 1; i < checks.length; i++) expect(checks[i]).not.toBe(checks[i - 1]);
  });

  test("the block lands at the end of the stream's user turn and names only menu forms", async () => {
    const menu = planMenu("Science");
    const forms = [...new Set(menu.map((m) => m.form))];
    const run = await decideStructure(
      { ...ctx("Year 1", "Science"), forms },
      stubEvaluator(),
      "stub",
    );
    for (const s of run.structure.slots) expect(forms).toContain(s.form);
    const block = structureBlock(run.structure, "Year 1");
    const p = streamLessonPrompt({
      topic: "Animals",
      audience: { subject: "Science", yearGroup: "Year 1" },
      slideCount: 9,
      menu,
      structure: block,
    });
    expect(p.user.endsWith(block)).toBe(true);
    expect(block).toContain("Every multiple-choice question has 3 options.");
  });
});
