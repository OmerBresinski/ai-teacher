import { describe, expect, test } from "bun:test";
import type { Lesson, LessonFacts } from "@tj/domain/documents";
import { assignFactIds } from "../src/specs";
import { FIXTURES, sampleBriefLesson } from "../src/testing";
import { labChecks } from "./lab";

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
