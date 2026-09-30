import { describe, expect, test } from "bun:test";
import type { PlanSlide } from "../prompts/plan-lesson";
import { renderWritten } from "./fit";
import {
  answerKeyMismatches,
  broadenedBrief,
  crossSlideFindings,
  fieldOfEvidence,
  limiter,
  NO_PICTURE_ROW,
  noPictureOf,
  noPictureTarget,
  type PassSlide,
  states,
} from "./slide-check";

const row = (over: Partial<PlanSlide>): PlanSlide => ({
  role: "teach",
  objectives: [1],
  tests: [],
  teaches: [],
  purpose: "",
  parts: 0,
  form: "explain",
  layout: "default",
  imageBrief: null,
  figureBrief: null,
  ...over,
});

describe("limiter", () => {
  test("runs at most the limit at once and every task", async () => {
    const run = limiter(2);
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active -= 1;
          done.push(n);
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test("a failing task frees its place", async () => {
    const run = limiter(1);
    await expect(run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await run(async () => 7)).toBe(7);
  });
});

describe("states", () => {
  test("the phrase or every content word", () => {
    expect(states("The answer is evaporation, because heat…", "Evaporation")).toBe(true);
    expect(states("It is the water cycle's first stage.", "the water cycle")).toBe(true);
    expect(states("Answer: 3.5 kg", "3.5 kg")).toBe(true);
    expect(states("The answer is condensation.", "evaporation")).toBe(false);
  });
});

describe("answerKeyMismatches", () => {
  const hinge = (correct: boolean[], notes: string) => ({
    notes,
    stem: "Which?",
    options: ["Erosion", "Deposition", "Transport", "Weathering"].map((text, i) => ({
      text,
      correct: correct[i] ?? false,
    })),
  });

  test("a hinge with one correct option its notes state holds", () => {
    expect(
      answerKeyMismatches("hinge", hinge([false, true], "Deposition. It drops load.")),
    ).toEqual([]);
  });

  test("a hinge with two correct options is written again in its options", () => {
    const f = answerKeyMismatches("hinge", hinge([true, true], "Erosion."));
    expect(f.map((x) => x.field)).toEqual(["options"]);
  });

  test("a hinge whose notes give another answer is written again in its notes", () => {
    const f = answerKeyMismatches("hinge", hinge([false, true], "The answer is erosion."));
    expect(f.map((x) => x.field)).toEqual(["notes"]);
  });

  test("true-false notes must say what the slide reveals", () => {
    const tf = (correct: boolean, notes: string) => ({ notes, statement: "s", correct });
    expect(answerKeyMismatches("true-false", tf(false, "False: rivers erode."))).toEqual([]);
    expect(answerKeyMismatches("true-false", tf(true, "False: rivers erode."))[0]?.field).toBe(
      "notes",
    );
    expect(answerKeyMismatches("true-false", tf(true, "Ask the class."))[0]?.field).toBe("notes");
  });

  test("fill-gap answers must be in the notes", () => {
    const fg = { notes: "Answer: meander.", stem: "", sentence: "A ___", answers: ["meander"] };
    expect(answerKeyMismatches("fill-gap", fg)).toEqual([]);
    expect(answerKeyMismatches("fill-gap", { ...fg, answers: ["delta"] })[0]?.field).toBe("notes");
  });

  test("a matching key used twice is written again in its pairs", () => {
    const m = {
      notes: "",
      stem: "",
      pairs: [
        { left: "a", right: "x" },
        { left: "b", right: "x" },
        { left: "c", right: "z" },
      ],
    };
    expect(answerKeyMismatches("matching", m)[0]?.field).toBe("pairs");
  });
});

describe("no picture", () => {
  test("keeps the heading, body and notes and drops the slot", () => {
    expect(
      noPictureOf({
        notes: "n",
        heading: "h",
        body: ["b"],
        imageBrief: { subject: "x", mustShow: [] },
      }),
    ).toEqual({ notes: "n", heading: "h", body: ["b"] });
  });

  test("the no-picture row draws the slides package's no-picture form of each picture slide", () => {
    const out = { notes: "n", heading: "Roman roads", body: ["They ran straight."] };
    const plain = renderWritten(NO_PICTURE_ROW.form, NO_PICTURE_ROW.layout, noPictureOf(out));
    const pictures = [
      ["photo", { ...out, imageBrief: { subject: "Roman road", mustShow: [] } }],
      ["diagram-slot", { ...out, diagram: { kind: "flow", alt: "a", steps: [] } }],
    ] as const;
    for (const [form, written] of pictures) {
      expect(noPictureTarget(form, "default", written)).toEqual({
        kind: plain.spec.kind,
        variant: plain.variant as string,
      });
    }
    expect(plain.structure.photo).toBeUndefined();
  });

  test("the retry brief is the subject's first three words and no must-show", () => {
    expect(
      broadenedBrief({
        subject: "river meander bend from above",
        mustShow: ["bank"],
        purpose: "context",
      }),
    ).toEqual({ subject: "river meander bend", mustShow: [], purpose: "context" });
    expect(broadenedBrief({ subject: "river", mustShow: [], purpose: "context" })).toBeUndefined();
  });
});

describe("crossSlideFindings", () => {
  const slides = (rows: Partial<PlanSlide>[], outs: Record<string, unknown>[] = []): PassSlide[] =>
    rows.map((r, i) => ({ number: i + 3, row: row(r), out: outs[i] ?? {}, slideId: `s${i + 3}` }));

  test("a lesson in order has no faults", () => {
    const f = crossSlideFindings(
      slides([
        { teaches: ["a"], objectives: [1] },
        { form: "hinge", role: "hinge", tests: ["a"], objectives: [1] },
      ]),
      { objectives: 1, secondSlideKind: "objectives" },
    );
    expect(f).toEqual([]);
  });

  test("tested before taught, no hinge, an untaught objective and a missing objectives slide", () => {
    const f = crossSlideFindings(
      slides([
        { form: "true-false", role: "check", tests: ["a"], objectives: [1] },
        { teaches: ["a"], objectives: [1] },
      ]),
      { objectives: 2, secondSlideKind: "content" },
    );
    const messages = f.map((x) => x.message);
    expect(messages).toContain("The objectives slide is not the second slide.");
    expect(messages).toContain("The lesson has 0 hinge questions; it has one.");
    expect(messages).toContain('Slide 3 tests objective 1, "a" before any slide teaches it.');
    expect(messages).toContain("Objective 2 is taught on no slide.");
    expect(f.find((x) => x.message.startsWith("Slide 3"))?.target).toEqual({ slideId: "s3" });
  });

  test("a term tested before the vocabulary slide that defines it", () => {
    const f = crossSlideFindings(
      slides(
        [
          { teaches: ["a"] },
          { form: "hinge", role: "hinge", tests: ["a"] },
          { form: "vocabulary", teaches: ["b"] },
        ],
        [
          {},
          { stem: "Where does a meander form?", options: [] },
          { entries: [{ term: "meander", definition: "a bend" }] },
        ],
      ),
      { objectives: 1, secondSlideKind: "objectives" },
    );
    expect(f.map((x) => x.message)).toEqual(['Slide 4 tests "meander" before slide 5 teaches it.']);
  });
});

describe("fieldOfEvidence", () => {
  test("the field the quote sits in, slide fields before notes", () => {
    const out = {
      notes: "rivers flow downhill",
      heading: "Rivers",
      body: ["Rivers flow downhill."],
    };
    expect(fieldOfEvidence(out, "flow downhill")).toBe("body");
    expect(fieldOfEvidence(out, "not there")).toBeUndefined();
  });
});
