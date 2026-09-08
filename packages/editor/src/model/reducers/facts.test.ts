import { describe, expect, test } from "bun:test";
import type { Proposal } from "@tj/domain";
import { generatedLesson, generatedWorksheet, text } from "@tj/domain/documents/fixtures";
import { applyBlockProposals } from "../../worksheet/reducers";
import * as r from "./index";

/* TEACH-134 rows 1–4: the facts reducers and the proposal application (ADR 0025 §18, §19). */

const GENERATED_FROM = {
  factRefs: ["o1"],
  promptVersion: "cascade.v1",
  model: "m",
  at: "2026-09-08T00:00:00.000Z",
};

describe("facts reducers", () => {
  test("updateFact patches an objective's text and is identity when unchanged", () => {
    const lesson = generatedLesson();
    const next = r.updateFact(lesson, "o1", { text: "Describe the water cycle" });
    expect(next.facts?.objectives[0]?.text).toBe("Describe the water cycle");
    expect(next.slides).toBe(lesson.slides);
    expect(r.updateFact(next, "o1", { text: "Describe the water cycle" })).toBe(next);
    expect(r.updateFact(lesson, "zz9", { text: "x" })).toBe(lesson);
  });

  test("updateFact reaches vocabulary, worked examples and questions", () => {
    const lesson = generatedLesson();
    let next = r.updateFact(lesson, "v1", { definition: "Water becoming vapour." });
    next = r.updateFact(next, "x1", { steps: ["Sun.", "Vapour."] });
    next = r.updateFact(next, "q1", { answer: "Evaporation!" });
    expect(next.facts?.vocabulary[0]?.definition).toBe("Water becoming vapour.");
    expect(next.facts?.workedExamples[0]?.steps).toEqual(["Sun.", "Vapour."]);
    expect(next.facts?.questions[0]?.answer).toBe("Evaporation!");
    // Same steps again: identity.
    expect(r.updateFact(next, "x1", { steps: ["Sun.", "Vapour."] })).toBe(next);
  });

  test("addFact mints one past the highest id anything still points at", () => {
    const lesson = generatedLesson();
    const added = r.addFact(lesson, { kind: "objective", text: "Name the three states" });
    expect(added.id).toBe("o3");
    expect(added.lesson.facts?.objectives.at(-1)).toEqual({
      id: "o3",
      text: "Name the three states",
    });
    // Remove o2: the objectives slide's element still derives from it, so o2 is never minted
    // again while that element exists; the next objective is o4.
    const removed = r.removeFact(added.lesson, "o2");
    const again = r.addFact(removed, { kind: "objective", text: "Another" });
    expect(again.id).toBe("o4");
    // Remove the brand-new o3 (nothing references it): o3 may come round again — no dangling
    // ref can point at the newcomer.
    const noRefs = r.removeFact(added.lesson, "o3");
    expect(r.addFact(noRefs, { kind: "objective", text: "Fresh" }).id).toBe("o3");
    const vocab = r.addFact(lesson, { kind: "vocabulary", term: "Cloud", definition: "…" });
    expect(vocab.id).toBe("v3");
    const noFacts = generatedLesson();
    delete noFacts.facts;
    expect(r.addFact(noFacts, { kind: "question", stem: "?", answer: "!", reasoning: "" })).toEqual(
      {
        lesson: noFacts,
        id: null,
      },
    );
  });

  test("removeFact drops the fact and every outline ref; elements keep their factRefs", () => {
    const lesson = generatedLesson();
    const next = r.removeFact(lesson, "v2");
    expect(next.facts?.vocabulary.map((v) => v.id)).toEqual(["v1"]);
    expect(next.facts?.outline.flatMap((e) => e.factRefs)).not.toContain("v2");
    expect(next.slides).toBe(lesson.slides);
    expect(r.removeFact(next, "v2")).toBe(next);
  });
});

describe("applyProposals", () => {
  const elementProposal = (): Proposal => {
    const lesson = generatedLesson();
    const slide = lesson.slides[1];
    const original = slide?.elements[1];
    if (!slide || !original) throw new Error("fixture");
    return {
      target: { slideId: slide.id, elementId: original.id },
      element: { ...original, id: "new-ob-1" },
      generatedFrom: GENERATED_FROM,
    };
  };

  test("an element proposal replaces that element in place; other slides keep identity", () => {
    const lesson = generatedLesson();
    const next = r.applyProposals(lesson, [elementProposal()]);
    const slide = next.slides[1];
    expect(slide?.elements.map((e) => e.id)).toEqual(["ob-h", "new-ob-1", "ob-2"]);
    expect(next.slides[0]).toBe(lesson.slides[0]);
    expect(next.slides[2]).toBe(lesson.slides[2]);
    expect(slide?.elements[0]).toBe(lesson.slides[1]?.elements[0]);
  });

  test("whole-slide proposals replace the elements in order and keep id, kind; notes and question follow", () => {
    const lesson = generatedLesson();
    const mc = lesson.slides[3];
    if (!mc) throw new Error("fixture");
    const fresh = mc.elements.slice(0, 3).map((el, i) => ({ ...el, id: `fresh-${i}` }));
    const question = {
      type: "multiple-choice" as const,
      options: [
        { id: "fresh-1", correct: true },
        { id: "fresh-2", correct: false },
      ],
    };
    const proposals: Proposal[] = fresh.map((element) => ({
      target: { slideId: mc.id },
      element,
      question,
      notes: null,
      generatedFrom: GENERATED_FROM,
    }));
    const next = r.applyProposals(lesson, proposals);
    const slide = next.slides[3];
    expect(slide?.id).toBe(mc.id);
    expect(slide?.kind).toBe("multiple-choice");
    expect(slide?.elements.map((e) => e.id)).toEqual(["fresh-0", "fresh-1", "fresh-2"]);
    expect(slide?.question).toEqual(question);
    expect(slide?.notes).toBeUndefined();
    // A whole-slide replacement without `question` clears the stale answer data.
    const plain = r.applyProposals(
      lesson,
      fresh.map((element) => ({
        target: { slideId: mc.id },
        element,
        generatedFrom: GENERATED_FROM,
      })),
    );
    expect(plain.slides[3]?.question).toBeUndefined();
    expect(plain.slides[3]?.notes).toBe(mc.notes);
  });

  test("unknown targets and block proposals are a no-op on the lesson", () => {
    const lesson = generatedLesson();
    expect(
      r.applyProposals(lesson, [
        {
          target: { slideId: "nope" },
          element: lesson.slides[0]?.elements[0],
          generatedFrom: GENERATED_FROM,
        },
        {
          target: { blockId: "wb2" },
          block: generatedWorksheet().blocks[1],
          generatedFrom: GENERATED_FROM,
        },
      ]),
    ).toBe(lesson);
  });

  test("proposalSlideIds lists touched slides in document order", () => {
    const lesson = generatedLesson();
    const [a, b] = [lesson.slides[3], lesson.slides[1]];
    if (!a || !b) throw new Error("fixture");
    const proposal = (slideId: string): Proposal => ({
      target: { slideId },
      element: a.elements[0],
      generatedFrom: GENERATED_FROM,
    });
    expect(r.proposalSlideIds(lesson, [proposal(a.id), proposal(b.id), proposal(a.id)])).toEqual([
      b.id,
      a.id,
    ]);
  });

  test("applyBlockProposals replaces a block in place and ignores slide proposals", () => {
    const worksheet = generatedWorksheet();
    const target = worksheet.blocks[1];
    if (!target) throw new Error("fixture");
    const block = { ...target, id: "wb2-new", doc: text("Explain the puddle.") };
    const next = applyBlockProposals(worksheet, [
      { target: { blockId: target.id }, block, generatedFrom: GENERATED_FROM },
      {
        target: { slideId: "s-mc" },
        element: generatedLesson().slides[0]?.elements[0],
        generatedFrom: GENERATED_FROM,
      },
    ]);
    expect(next.blocks.map((b) => b.id)[1]).toBe("wb2-new");
    expect(next.blocks[0]).toBe(worksheet.blocks[0]);
    expect(applyBlockProposals(next, [])).toBe(next);
  });
});
