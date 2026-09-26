import { describe, expect, test } from "bun:test";
import type { LessonFacts, OutlineEntry } from "@tj/domain/documents";
import { CONTENT_BUDGETS, CONTENT_SHAPES } from "@tj/slides";
import { plannedShapeOf, shapeLine, withPlannedShape } from "./generate-slide";

/* v31: the planned shape reaches the slide line, with budgets read from CONTENT_BUDGETS. */

const idea = (id: string, extra: Record<string, string> = {}) => ({
  id,
  statement: "s",
  explanation: "e",
  example: "x",
  objectiveRefs: ["o1"],
  ...extra,
});
const facts = (...keyIdeas: ReturnType<typeof idea>[]) => ({ keyIdeas }) as unknown as LessonFacts;
const entry = (kind: string, factRefs: string[]) => ({ id: "e1", kind, factRefs }) as OutlineEntry;

describe("generate-slide v31 planned shape", () => {
  test("one key idea keeps its shape and visual; two are explain", () => {
    const list = idea("k1", { shape: "list", visual: "Parts: a, b" });
    expect(plannedShapeOf(facts(list), entry("content", ["k1"]))).toEqual({
      shape: "list",
      ideas: 1,
      visual: "Parts: a, b",
    });
    expect(plannedShapeOf(facts(list, idea("k2")), entry("content", ["k1", "k2"]))?.shape).toBe(
      "explain",
    );
    expect(plannedShapeOf(facts(list), entry("image-text", ["k1"]))).toBeUndefined();
  });

  test("legacy facts plan no shape, so the writer's content slide comes through untouched", () => {
    // AI_LESSON_PLANNER=legacy (the production default) writes key ideas without a shape.
    const legacy = facts(idea("k1"), idea("k2"));
    expect(plannedShapeOf(legacy, entry("content", ["k1"]))).toBeUndefined();
    expect(plannedShapeOf(legacy, entry("content", ["k1", "k2"]))).toBeUndefined();
    expect(plannedShapeOf(legacy, entry("content", []))).toBeUndefined();
    const written = {
      kind: "content",
      heading: "Types",
      body: "Lead.",
      points: ["a b", "c d"],
      compare: { left: { label: "L", points: ["x"] }, right: { label: "R", points: ["y"] } },
      steps: ["x", "y"],
      diagram: "Cycle: a → b",
      factRefs: [],
    };
    // As on master: the spec the writer returned is the spec that is materialised.
    const shaped = withPlannedShape(written, plannedShapeOf(legacy, entry("content", ["k1"])));
    expect(shaped.spec).toBe(written);
    expect(shaped).toMatchObject({ filled: true, extra: [] });
  });

  test("each shape's line names only its own field, with the budget's numbers", () => {
    for (const shape of CONTENT_SHAPES) {
      const line = shapeLine({ shape, ideas: 1 });
      const b = CONTENT_BUDGETS[shape];
      expect(line).toStartWith(`Shape: ${shape}.`);
      expect(line).toContain(`"heading" (a label, ≤ ${b.heading.max} words)`);
      expect(line).toContain(`≤ ${b.lead.max} words`);
      const own = { explain: "body", list: "points", compare: "compare", sequence: "steps" }[shape];
      for (const other of ['"points"', '"compare"', '"steps"']) {
        if (other !== `"${own}"` && !(shape === "compare" && other === '"points"')) {
          expect(line).not.toContain(other);
        }
      }
    }
    expect(shapeLine({ shape: "list", ideas: 1 })).toContain(
      `"points" (${CONTENT_BUDGETS.list.points?.count?.[0]}–${CONTENT_BUDGETS.list.points?.count?.[1]} strings, each ≤ ${CONTENT_BUDGETS.list.points?.max} words`,
    );
    expect(shapeLine({ shape: "explain", ideas: 2 })).toContain("two short paragraphs");
  });

  test("the spec keeps its shape's field and the plan's drawing only", () => {
    const spec = {
      kind: "content",
      heading: "Types",
      body: "Lead.",
      points: ["a b", "c d"],
      steps: ["x", "y"],
      diagram: "Sequence: writer's own",
      factRefs: [],
    };
    const listed = withPlannedShape(spec, { shape: "list", ideas: 1, visual: "Parts: a, b" });
    expect(listed.spec as unknown).toEqual({
      kind: "content",
      heading: "Types",
      body: "Lead.",
      points: ["a b", "c d"],
      diagram: "Parts: a, b",
      factRefs: [],
    });
    expect(listed).toMatchObject({ filled: true, extra: ["steps"] });
    const compared = withPlannedShape(spec, { shape: "compare", ideas: 1, visual: "untyped" });
    expect(compared.filled).toBe(false);
    expect("diagram" in compared.spec).toBe(false);
    expect("points" in compared.spec).toBe(false);
    const question = { kind: "open-response", points: ["a"] };
    expect(withPlannedShape(question, undefined).spec).toBe(question);
  });
});
