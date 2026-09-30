import { describe, expect, test } from "bun:test";
import type { DesignSlot } from "../prompts/design-cycle";
import {
  answerSupport,
  askedOf,
  keyTerms,
  refsOfSlot,
  taughtText,
  unsupportedReason,
} from "./answer-support";

const teach = {
  form: "sequence",
  heading: "How a river deposits",
  steps: ["The river slows down", "It loses energy", "It drops sediment on the floodplain"],
  notes: "Mention the Nile delta and alluvium.",
} as unknown as DesignSlot;

const hinge = (answer: string) =>
  ({
    form: "hinge",
    stem: "Why does a river drop sediment?",
    options: [
      { text: answer, correct: true },
      { text: "It speeds up", correct: false },
    ],
    notes: "",
  }) as unknown as DesignSlot;

describe("answer on a slide (r6)", () => {
  test("slide text counts, notes never do", () => {
    expect(taughtText(teach)).toContain("floodplain");
    expect(taughtText(teach)).not.toContain("alluvium");
    expect(taughtText(hinge("x"))).toBe("");
  });

  test("a check's answer taught on an earlier slide passes by word overlap", () => {
    const q = askedOf(hinge("It loses energy and slows"));
    expect(q).toBeDefined();
    const [s] = answerSupport(
      [{ slide: 4, where: "check", question: q?.question ?? "", answer: q?.answer ?? "" }],
      [{ slide: 3, text: taughtText(teach) }],
    );
    expect(s).toMatchObject({ ok: true, by: "overlap" });
  });

  test("an answer only in the notes, or only on a later slide, fails and names what is missing", () => {
    const q = askedOf(hinge("Alluvium builds the delta"));
    const asked = [
      { slide: 4, where: "check" as const, question: q?.question ?? "", answer: q?.answer ?? "" },
    ];
    const [s] = answerSupport(asked, [
      { slide: 3, text: taughtText(teach) },
      { slide: 5, text: "Alluvium builds the delta" },
    ]);
    expect(s?.ok).toBe(false);
    expect(s?.missing).toEqual(expect.arrayContaining(keyTerms("alluvium delta")));
    const reason = unsupportedReason(s as NonNullable<typeof s>, [3]);
    expect(reason).toContain("slides 3");
    expect(reason).not.toMatch(/notes/);
  });

  test("refs decide when both sides carry them", () => {
    const withRefs = { ...teach, keyIdeaRefs: ["k1"] } as unknown as DesignSlot;
    expect(refsOfSlot(withRefs)).toEqual(["k1"]);
    expect(refsOfSlot(teach)).toBeUndefined();
    const [ok, bad] = answerSupport(
      [
        { slide: 4, where: "check", question: "", answer: "anything", refs: ["k1"] },
        { slide: 4, where: "check", question: "", answer: "anything", refs: ["k2"] },
      ],
      [{ slide: 3, text: "x", refs: ["k1"] }],
    );
    expect(ok).toMatchObject({ ok: true, by: "refs" });
    expect(bad).toMatchObject({ ok: false, by: "refs", missing: ["k2"] });
  });

  test("an opening leans on the prior knowledge the brief states; a bare number has nothing to check", () => {
    const [opening, sum] = answerSupport(
      [
        {
          slide: 2,
          where: "opening",
          question: "What is evaporation?",
          answer: "Water turning to vapour",
        },
        { slide: 2, where: "check", question: "What is 3 + 4?", answer: "7" },
      ],
      [],
      { priorKnowledge: "Pupils know the water cycle: water turns to vapour when heated." },
    );
    expect(opening?.ok).toBe(true);
    expect(sum).toMatchObject({ ok: true, by: "nothing-to-check" });
  });
});
