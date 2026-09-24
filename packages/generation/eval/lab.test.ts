import { describe, expect, test } from "bun:test";
import type { Lesson, LessonFacts } from "@tj/domain/documents";
import { assignFactIds } from "../src/specs";
import { FIXTURES, sampleBriefLesson } from "../src/testing";
import { labChecks, parsePriority, readinessLine } from "./lab";

/* The w0 lab checks added for the zero-spend fixes: objectives shown, echoed distractors, numbers. */

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});
const text = (id: string, ...paragraphs: string[]) => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  w: 100,
  h: 20,
  doc: doc(...paragraphs),
  style: { preset: "body" },
});

function lessonWith(facts: LessonFacts, slides: unknown[]): Lesson {
  return { ...sampleBriefLesson(), facts, slides } as unknown as Lesson;
}
const checks = (lesson: Lesson, name: string) => labChecks(lesson).filter((f) => f.check === name);
const facts = () => assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);

describe("labChecks: w0 additions", () => {
  test("objectives-slide-incomplete: an objectives slide missing one objective is flagged", () => {
    const f = facts();
    const all = f.objectives.map((o) => o.text.toLowerCase());
    const full = { id: "s2", kind: "objectives", elements: [text("t", ...all)] };
    expect(checks(lessonWith(f, [full]), "objectives-slide-incomplete")).toEqual([]);
    if (all.length < 2) throw new Error("fixture needs two objectives");
    const short = { id: "s2", kind: "objectives", elements: [text("t", all[0] ?? "")] };
    const [finding] = checks(lessonWith(f, [short]), "objectives-slide-incomplete");
    expect(finding?.detail).toMatch(`shows 1 of ${all.length} objectives`);
  });

  test("distractor-equals-answer: on the facts, case and punctuation aside", () => {
    const f = facts();
    const q = f.questions.find((x) => (x.distractors?.length ?? 0) > 0);
    const d = q?.distractors?.[0];
    if (!q || !d) throw new Error("fixture has no question with distractors");
    expect(checks(lessonWith(f, []), "distractor-equals-answer")).toEqual([]);
    d.text = `${q.answer.toUpperCase()}!`;
    expect(checks(lessonWith(f, []), "distractor-equals-answer")).toHaveLength(1);
  });

  test("numeric-mismatch: the trig-2 answer on the facts and on a worked-example slide; a stem is not read", () => {
    const f = facts();
    const q = f.questions[0];
    if (!q) throw new Error("fixture has no question");
    q.answer = "Use sine: sin(40°) = 6 cm ÷ 10 cm.";
    q.stem = "Is sin(40°) = 7 ÷ 10?";
    const slides = [
      { id: "s6", kind: "worked-example", elements: [text("w", "10 × sin(40°) = 6.4 cm")] },
      { id: "s7", kind: "open-response", elements: [text("o", "Does 3 × 4 = 13?")] },
      { id: "s8", kind: "content", elements: [text("c", "So 3 × 4 = 13.")] },
    ];
    const found = checks(lessonWith(f, slides), "numeric-mismatch");
    expect(found.map((x) => x.slide)).toEqual([undefined, 3]);
    expect(found[0]?.detail).toMatch("sin(40°) = 6 cm ÷ 10 cm");
  });
});

describe("readiness marks (lab pw latency)", () => {
  const t0 = 1_000_000;
  const events = [
    { atMs: 500, stage: "plan" },
    { atMs: 33_000, stage: "plan" },
    { atMs: 38_000, stage: "generate" },
    { atMs: 42_000, stage: "generate" },
    { atMs: 60_000, stage: "evaluate" },
    { atMs: 66_000, stage: "repair" },
  ];
  const calls = [
    { promptVersion: "plan-objectives.v13", endedAt: t0 + 7_000 },
    { promptVersion: "plan-teach-objective.v1", endedAt: t0 + 20_000 },
    { promptVersion: "generate-slide.v23", endedAt: t0 + 37_000 },
    { promptVersion: "generate-slide.v23", endedAt: t0 + 35_500 },
  ];

  test("first objectives and first slide from call ends; ready before Evaluate; checked after Repair", () => {
    expect(readinessLine(events, calls, t0)).toBe(
      "title slide at 0.5 s, first objectives at 7.0 s, first slide at 35.5 s, ready at 42.0 s, checked-and-repaired at 66.0 s",
    );
  });

  test("a mark the run never reached is a dash", () => {
    expect(readinessLine(events.slice(0, 2), [], t0)).toBe(
      "title slide at 0.5 s, first objectives at -, first slide at -, ready at -, checked-and-repaired at -",
    );
  });

  test("illustrate counts toward ready", () => {
    expect(readinessLine([...events, { atMs: 45_000, stage: "illustrate" }], calls, t0)).toContain(
      "ready at 45.0 s",
    );
  });
});

test("--priority names stages or prompts, comma-separated; unset is none", () => {
  expect([...parsePriority("plan, evaluate,")]).toEqual(["plan", "evaluate"]);
  expect(parsePriority(undefined).size).toBe(0);
});
