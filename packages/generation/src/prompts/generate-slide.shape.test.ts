import { describe, expect, test } from "bun:test";
import type { LessonFacts, OutlineEntry } from "@tj/domain/documents";
import { COMPOSITION_BUDGETS, CONTENT_SHAPES } from "@tj/slides";
import { plannedShapeOf, shapeLine, withPlannedShape } from "./generate-slide";

/* v31: the planned shape reaches the slide line; v33: as a layout hint, with no word budgets. */

const idea = (id: string, extra: Record<string, string> = {}) => ({
  id,
  statement: "s",
  explanation: "e",
  example: "x",
  objectiveRefs: ["o1"],
  ...extra,
});
const facts = (...keyIdeas: ReturnType<typeof idea>[]) => ({ keyIdeas }) as unknown as LessonFacts;
const entry = (kind: string, factRefs: string[], extra: Record<string, unknown> = {}) =>
  ({ id: "e1", kind, factRefs, ...extra }) as OutlineEntry;

describe("generate-slide v33 planned shape", () => {
  test("one key idea keeps its shape and visual; two are explain", () => {
    const list = idea("k1", { shape: "list", visual: "Parts: a, b" });
    expect(plannedShapeOf(facts(list), entry("content", ["k1"]))).toEqual({
      shape: "list",
      ideas: 1,
      visual: "Parts: a, b",
      beside: "diagram",
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

  test("each shape's line names only its own field, in full sentences, with no word cap", () => {
    // v33 (look/shape-fixes): the line is a layout hint; the budgets stay the renderer's data.
    for (const shape of CONTENT_SHAPES) {
      const line = shapeLine({ shape, ideas: 1 });
      expect(line).toStartWith(`Layout: ${shape}.`);
      expect(line).not.toMatch(/≤ \d+ words|Fill exactly/);
      const own = { explain: "body", list: "points", compare: "compare", sequence: "steps" }[shape];
      for (const other of ['"points"', '"compare"', '"steps"']) {
        if (other !== `"${own}"` && !(shape === "compare" && other === '"points"')) {
          expect(line).not.toContain(other);
        }
      }
    }
    expect(shapeLine({ shape: "list", ideas: 1 })).toContain('"Label: one full sentence"');
    expect(shapeLine({ shape: "compare", ideas: 1 })).toContain("2–3 full sentences");
    expect(shapeLine({ shape: "sequence", ideas: 1 })).toContain("2–4 full sentences in order");
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

  test("v34: a planned photograph or diagram gives an explain or a list the half-column target", () => {
    const photo = { imageBrief: { subject: "Roman road", purpose: "context" } };
    const explain = plannedShapeOf(facts(idea("k1", { shape: "explain" })), {
      ...entry("content", ["k1"], photo),
    });
    expect(explain?.beside).toBe("photograph");
    const panel = COMPOSITION_BUDGETS.explain.panel;
    const most = (panel?.lead.max ?? 0) + (panel?.body?.max ?? 0);
    const line = shapeLine(explain as NonNullable<typeof explain>);
    expect(line).toStartWith("Layout: explain. A photograph takes the right half");
    expect(line).toContain(`–${most} words, no more`);
    expect(line).toContain("full sentences");
    const list = shapeLine({ shape: "list", ideas: 1, beside: "photograph" });
    expect(list).toContain(`up to ${COMPOSITION_BUDGETS.list.panel?.points?.max} words in all`);
    expect(list).toContain("2–3 strings");
    // Compare and sequence drop the slot, so they keep the full-width line.
    const compare = plannedShapeOf(facts(idea("k1", { shape: "compare" })), {
      ...entry("content", ["k1"], photo),
    });
    expect(compare?.beside).toBeUndefined();
    expect(shapeLine({ shape: "explain", ideas: 1 })).not.toContain("right half");
  });
});
