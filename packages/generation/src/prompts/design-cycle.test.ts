import { describe, expect, test } from "bun:test";
import { PALETTE, type SlideSpec } from "@tj/slides";
import {
  designCyclePrompt,
  designCycleSchemaFor,
  ROLE_FORMS,
  SLOT_ROLES,
  slotFormsFor,
  slotRoles,
} from "./design-cycle";
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

  test("v12: an objective's facts render as its source, only for this call's objective", () => {
    const plain = designCyclePrompt.user(DESIGN_CYCLE_SAMPLE);
    expect(plain).not.toContain("Source for objective");
    const objectives = DESIGN_CYCLE_SAMPLE.objectives.map((o, i) => ({
      ...o,
      facts: i === 0 ? "Other objective's facts" : "Legions of about 5,000 men, in ten cohorts.",
    }));
    const withFacts = designCyclePrompt.user({ ...DESIGN_CYCLE_SAMPLE, objectives });
    expect(withFacts).toContain(
      "Source for objective 2: its slides state these facts, cases, numbers and dates and no others.\nLegions of about 5,000 men, in ten cohorts.",
    );
    expect(withFacts).not.toContain("Other objective's facts");
    expect(withFacts).not.toMatch(noBudget);
    // Empty and whitespace-only blocks render nothing (arm P leaves the field empty).
    expect(
      designCyclePrompt.user({
        ...DESIGN_CYCLE_SAMPLE,
        objectives: DESIGN_CYCLE_SAMPLE.objectives.map((o) => ({ ...o, facts: "  " })),
      }),
    ).not.toContain("Source for objective");
  });

  test("the user turn opens with the palette, then the arc, and names this call's slots", () => {
    const user = designCyclePrompt.user(DESIGN_CYCLE_SAMPLE);
    expect(user.startsWith("Palette")).toBe(true);
    expect(user).toContain(DESIGN_CYCLE_SAMPLE.palette);
    expect(user).toContain("2. Describe how the Roman army was organised  <- this call");
    expect(user).toContain("Misconception: The Romans left no trace in Britain");
    expect(user).toContain("Design objective 2: 2 slots, slides 6 to 7 of 10.");
    // v6: each slot's role, from the count and this objective's lean (photo -> show first).
    expect(user).toContain("  slide 6: show\n  slide 7: check");
    const given = designCyclePrompt.user({
      ...DESIGN_CYCLE_SAMPLE,
      slots: { ...DESIGN_CYCLE_SAMPLE.slots, roles: ["teach", "practise"] },
    });
    expect(given).toContain("  slide 6: teach\n  slide 7: practise");
  });

  test("slot roles: first teaches or shows by the lean, last checks, practise first for a method", () => {
    expect(slotRoles(1, "explain")).toEqual(["teach"]);
    expect(slotRoles(1, "photo")).toEqual(["show"]);
    expect(slotRoles(2, "worked-example")).toEqual(["teach", "check"]);
    expect(slotRoles(3, "worked-example")).toEqual(["teach", "practise", "check"]);
    expect(slotRoles(3, "diagram-slot")).toEqual(["show", "teach", "check"]);
    expect(slotRoles(3, undefined)).toEqual(["teach", "teach", "check"]);
    expect(slotRoles(6, "sequence")).toEqual([
      "teach",
      "teach",
      "practise",
      "teach",
      "practise",
      "check",
    ]);
    // Every role's forms are slide forms the schema offers, and the four sets partition the checks.
    for (const role of SLOT_ROLES) {
      for (const form of ROLE_FORMS[role]) expect(slotFormsFor(undefined)).toContain(form);
    }
    expect(ROLE_FORMS.check).not.toContain("open-response");
    expect(ROLE_FORMS.practise).toContain("open-response");
  });

  test("a re-fill is shown the slot it replaces and why, as structure; a cycle call is not", () => {
    const refill = designCyclePrompt.user({
      ...DESIGN_CYCLE_SAMPLE,
      slots: { count: 1, first: 7, slideCount: 10 },
      replacing: {
        form: "hinge",
        material: JSON.stringify({ stem: "Why?", options: [{ text: "Because.", correct: true }] }),
        reason:
          "it did not fit its slide because the options are sentences; this form needs phrases",
        into: "true-false",
      },
    });
    expect(refill).toContain(
      "This slot replaces a hinge slot: it did not fit its slide because the options are sentences; this form needs phrases.",
    );
    expect(refill).toContain('Its material: {"stem":"Why?"');
    expect(refill).toContain("Write the same content as a true-false slot.");
    expect(refill).not.toMatch(noBudget);
    expect(designCyclePrompt.user(DESIGN_CYCLE_SAMPLE)).not.toContain("replaces");
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
