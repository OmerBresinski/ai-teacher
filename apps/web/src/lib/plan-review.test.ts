import { describe, expect, it } from "bun:test";
import { LessonFactsSchema } from "@tj/domain/documents";
import { plannedFacts } from "@tj/domain/documents/fixtures";
import {
  factsOf,
  initPlanReview,
  isYours,
  PLAN_STEPS,
  type PlanReviewAction,
  planReviewReducer,
  totalMinutes,
  worksheetOutlineOf,
} from "./plan-review";

const run = (...actions: PlanReviewAction[]) =>
  actions.reduce(planReviewReducer, initPlanReview(plannedFacts()));

describe("planReviewReducer", () => {
  it("starts on Objectives with nothing touched and the plan's facts intact", () => {
    const state = initPlanReview(plannedFacts());
    expect(state.step).toBe("objectives");
    expect(isYours(state, "objective:o1")).toBe(false);
    expect(factsOf(state)).toEqual(plannedFacts());
    expect(totalMinutes(state)).toBe(60);
    expect(state.phases[3]?.summary).toBe("Particle, Solid, Liquid, Gas");
  });

  it("touching a field marks it yours and leaves the others suggested", () => {
    const state = run({ type: "editObjective", id: "o2", text: "Explain changes of state" });
    expect(isYours(state, "objective:o2")).toBe(true);
    expect(isYours(state, "objective:o1")).toBe(false);
    expect(factsOf(state).objectives[1]?.text).toBe("Explain changes of state");
  });

  it("removing a fact strips its references; reordering keeps refs valid", () => {
    const state = run(
      { type: "removeObjective", id: "o1" },
      { type: "removeVocabulary", id: "v2" },
      { type: "movePhase", from: 3, to: 1 },
      { type: "addObjective" },
      { type: "addVocabulary" },
      { type: "addPhase", kind: "plenary" },
    );
    const facts = factsOf(state);
    expect(LessonFactsSchema.safeParse(facts).success).toBe(true);
    expect(facts.outline.some((entry) => entry.factRefs.includes("o1"))).toBe(false);
    expect(facts.outline[1]?.kind).toBe("vocabulary");
    // Minted ids never collide with the ones Plan used.
    expect(facts.objectives.at(-1)?.id).toBe("o4");
    expect(facts.vocabulary.at(-1)?.id).toBe("v7");
    expect(facts.outline.at(-1)).toMatchObject({ id: "s11", kind: "plenary", minutes: 5 });
    expect(isYours(state, "phases:order")).toBe(true);
  });

  it("keeps the minutes total honest", () => {
    const state = run(
      { type: "editPhase", id: "s3", minutes: 12 },
      { type: "removePhase", id: "s9" },
    );
    expect(totalMinutes(state)).toBe(60 + 7 - 8);
    expect(isYours(state, "phase:s3")).toBe(true);
    expect(factsOf(state).durationMin).toBe(60);
  });

  it("walks the steps: next marks done, back returns, go only reaches seen steps", () => {
    let state = run({ type: "next" }, { type: "next" });
    expect(state.step).toBe("words");
    expect(state.done).toEqual(["objectives", "shape"]);
    state = planReviewReducer(state, { type: "go", step: "summary" });
    expect(state.step).toBe("words");
    state = planReviewReducer(state, { type: "back" });
    expect(state.step).toBe("shape");
    state = planReviewReducer(state, { type: "go", step: "objectives" });
    expect(state.step).toBe("objectives");
  });

  it("accept-all lands on Summary with every step done and nothing marked yours", () => {
    const state = run({ type: "acceptAll" });
    expect(state.step).toBe("summary");
    expect(state.done).toEqual(PLAN_STEPS.map((s) => s.id).filter((id) => id !== "summary"));
    expect(Object.keys(state.touched)).toEqual([]);
    expect(LessonFactsSchema.safeParse(factsOf(state)).success).toBe(true);
  });

  it("derives a worksheet outline and edits it", () => {
    const outline = worksheetOutlineOf(plannedFacts());
    expect(outline.enabled).toBe(true);
    expect(outline.blocks.map((b) => b.type)).toEqual([
      "heading",
      "instructions",
      "word-bank",
      "question",
      "question",
      "fill-gap",
      "multiple-choice",
    ]);
    const state = run(
      { type: "toggleTier", tier: "support" },
      { type: "removeBlock", index: 0 },
      { type: "addBlock", blockType: "matching" },
      { type: "setWorksheetEnabled", enabled: false },
    );
    expect(state.worksheet.tiers).toEqual(["core", "challenge"]);
    expect(state.worksheet.blocks.at(-1)?.type).toBe("matching");
    expect(state.worksheet.enabled).toBe(false);
    expect(isYours(state, "worksheet:enabled")).toBe(true);
  });
});
