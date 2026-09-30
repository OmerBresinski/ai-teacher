import { describe, expect, test } from "bun:test";
import { PALETTE, type SlideSpec } from "@tj/slides";
import { designCyclePrompt, designCycleSchemaFor, slotFormsFor } from "./design-cycle";
import { planObjectivesPrompt } from "./plan-objectives";
import { DESIGN_CYCLE_SAMPLE } from "./plan-samples";

const noBudget =
  /\b(\d+\s*(words?|characters?|chars?)|word (limit|count|budget)|characters? (limit|budget)|shorten|concise|summari[sz]e)\b/i;

describe("design-cycle", () => {
  test("no word or character budget and no 'shorten' in either designer prompt (ruling 132)", () => {
    for (const text of [
      designCyclePrompt.system,
      designCyclePrompt.user(DESIGN_CYCLE_SAMPLE),
      planObjectivesPrompt.system.replace("at most 16 words", ""),
    ]) {
      expect(text).not.toMatch(noBudget);
    }
  });

  test("the user turn opens with the palette, then the arc, and names this call's slots", () => {
    const user = designCyclePrompt.user(DESIGN_CYCLE_SAMPLE);
    expect(user.startsWith("Palette")).toBe(true);
    expect(user).toContain(DESIGN_CYCLE_SAMPLE.palette);
    expect(user).toContain("2. Describe how the Roman army was organised  <- this call");
    expect(user).toContain("Misconception: The Romans left no trace in Britain");
    expect(user).toContain("Design objective 2: 2 slots, slides 6 to 7 of 10.");
  });

  test("the form enum is the subject's slide forms; a figure only where a template exists", () => {
    expect(slotFormsFor("History")).not.toContain("figure");
    expect(slotFormsFor("Maths")).toContain("figure");
    for (const s of ["History", "Maths"]) {
      expect(slotFormsFor(s)).not.toContain("notes");
      expect(slotFormsFor(s)).not.toContain("worksheet");
    }
  });

  test("material fields carry the palette example's names, so the example calibrates them", () => {
    const schema = designCycleSchemaFor("Maths", 1);
    const slot = schema.shape.slots.element;
    for (const form of PALETTE.filter((f) => f.renderer.on === "slide")) {
      const option = slot.options.find((o) => o.shape.form.value === form.id);
      expect(option, form.id).toBeDefined();
      const { kind: _k, factRefs: _f, notes: _n, ...fields } = form.example as SlideSpec;
      const keys = Object.keys(fields).filter((k) => !(form.id === "figure" && k === "figure"));
      const named = Object.keys(option?.shape ?? {});
      for (const key of keys) expect(named, `${form.id}.${key}`).toContain(key);
    }
  });

  test("the schema pins the slot count and every structural count", () => {
    const schema = designCycleSchemaFor("History", 2);
    const exit = { question: "Why did Rome invade?", answer: "For tin and glory." };
    const explain = {
      form: "explain",
      notes: "Say it.",
      heading: "Rome wanted tin",
      body: "Britain had tin.",
    };
    const list = (n: number) => ({ ...explain, form: "list", points: Array(n).fill("A point") });
    expect(schema.safeParse({ slots: [explain, list(2)], exitQuestion: exit }).success).toBe(true);
    expect(schema.safeParse({ slots: [explain, list(3)], exitQuestion: exit }).success).toBe(false);
    expect(schema.safeParse({ slots: [explain], exitQuestion: exit }).success).toBe(false);
    expect(schema.safeParse({ slots: [explain, explain] }).success).toBe(false);
    const hinge = (n: number) => ({
      form: "hinge",
      stem: "Why?",
      options: Array(n).fill({ text: "Tin", correct: false }),
      explanation: "Because.",
    });
    expect(schema.safeParse({ slots: [explain, hinge(4)], exitQuestion: exit }).success).toBe(true);
    expect(schema.safeParse({ slots: [explain, hinge(3)], exitQuestion: exit }).success).toBe(
      false,
    );
    const figure = {
      ...explain,
      form: "figure",
      figureBrief: { template: "triangle", purpose: "x" },
    };
    expect(schema.safeParse({ slots: [explain, figure], exitQuestion: exit }).success).toBe(false);
  });
});
