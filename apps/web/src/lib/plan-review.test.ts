import { describe, expect, it } from "bun:test";
import { LessonFactsSchema } from "@tj/domain/documents";
import { plannedFacts } from "@tj/domain/documents/fixtures";
import {
  factsOf,
  initPlanReview,
  isSectionYours,
  isYours,
  type PlanReviewAction,
  planReviewReducer,
  sectionsYours,
  totalMinutes,
  worksheetOutlineOf,
} from "./plan-review";

const run = (...actions: PlanReviewAction[]) =>
  actions.reduce(planReviewReducer, initPlanReview(plannedFacts()));

describe("planReviewReducer", () => {
  it("starts with nothing touched and the plan's facts intact", () => {
    const state = initPlanReview(plannedFacts());
    expect(isYours(state, "objective:o1")).toBe(false);
    expect(sectionsYours(state)).toEqual([]);
    expect(factsOf(state)).toEqual(plannedFacts());
    expect(totalMinutes(state)).toBe(60);
  });

  it("touching a field marks it yours and leaves the others suggested", () => {
    const state = run({ type: "editObjective", id: "o2", text: "Explain changes of state" });
    expect(isYours(state, "objective:o2")).toBe(true);
    expect(isYours(state, "objective:o1")).toBe(false);
    expect(isSectionYours(state, "objectives")).toBe(true);
    expect(sectionsYours(state)).toEqual(["objectives"]);
    expect(factsOf(state).objectives[1]?.text).toBe("Explain changes of state");
  });

  it("removing a fact strips its references; reordering keeps refs valid", () => {
    const state = run(
      { type: "removeObjective", id: "o1" },
      { type: "removeVocabulary", id: "v2" },
      { type: "movePhase", from: 3, to: 1 },
      { type: "addObjective" },
      { type: "addVocabulary", term: "Freezing" },
      { type: "addPhase", kind: "plenary" },
    );
    const facts = factsOf(state);
    expect(LessonFactsSchema.safeParse(facts).success).toBe(true);
    expect(facts.outline.some((entry) => entry.factRefs.includes("o1"))).toBe(false);
    expect(facts.outline[1]?.kind).toBe("vocabulary");
    // Minted ids never collide with the ones Plan used.
    expect(facts.objectives.at(-1)?.id).toBe("o4");
    expect(facts.vocabulary.at(-1)).toEqual({ id: "v7", term: "Freezing", definition: "" });
    expect(facts.outline.find((entry) => entry.kind === "vocabulary")?.factRefs).toContain("v7");
    expect(sectionsYours(state)).toEqual(["objectives", "shape", "words"]);
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

  it("ignores a blank word", () => {
    const state = run({ type: "addVocabulary", term: "   " });
    expect(state.vocabulary).toHaveLength(6);
    expect(sectionsYours(state)).toEqual([]);
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
