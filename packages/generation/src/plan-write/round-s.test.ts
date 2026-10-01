import { describe, expect, test } from "bun:test";
import recorded from "../fixtures/round-s1-recorded.json";
import type { ExitItemsInput, ExitItemsOutput } from "../prompts/exit-items";
import { closingFits, closingQuestionsWritten, coveringOrder } from "./closing";
import { untaughtOnExit, untaughtTerms } from "./gates";
import { slideWriterSchema } from "./menu";
import { modelExitItems } from "./model-exit";
import type { PassSlide } from "./slide-check";

/*
 * Round S fixes, on what round S1 recorded (stored lessons, offline): the untaught gate over the
 * y5 lesson whose slide 7 writer failed, and the y6 exit ticket that reached the slide with one item.
 */

/** Slide 7's writer failed twice: drawn as a discussion of its purpose. `marked`: its plan row
 * as round S now places it (teaching nothing, testing what it was to teach). */
const y5 = (marked: boolean): PassSlide[] =>
  recorded.y5Slides.map((s) => ({
    number: s.number,
    row: (s.number !== 7
      ? s.row
      : marked
        ? { ...s.row, form: "discussion", teaches: [], tests: [...s.row.tests, ...s.row.teaches] }
        : { ...s.row, form: "discussion" }) as unknown as PassSlide["row"],
    out: { body: s.body },
  }));

describe("untaught gate on S1 y5", () => {
  test("the writer-failure discussion and the practice items on its term are caught", () => {
    // As drawn: slide 7 a discussion of its purpose, teaching nothing (its teaches now tested).
    const found = untaughtTerms(y5(true));
    expect(found.map((u) => [u.number, u.terms])).toEqual([
      [7, ["bend"]],
      [10, ["bend"]],
    ]);
  });
  test("a discussion is a question slide, marked or not", () => {
    expect(untaughtTerms(y5(false)).map((u) => u.number)).toEqual([7, 10]);
  });
  test("a question slide does not count as teaching what it names", () => {
    const slides = y5(true).map((s) =>
      s.number === 8 ? { ...s, out: { body: `${String(s.out.body)} The bend.` } } : s,
    );
    expect(untaughtTerms(slides).some((u) => u.number === 10)).toBe(true);
  });
  test("exit items are checked after every slide", () => {
    const slides = y5(true);
    expect(untaughtOnExit(slides, ["Explain how a bend changes."])).toEqual([
      { item: 0, terms: ["bend"] },
    ]);
    expect(untaughtOnExit(slides, ["What is a tributary?"])).toEqual([]);
  });
});

/** The recorded y6 items as the model wrote them (the printed options split back off). */
const y6Raw = (): ExitItemsOutput["items"] =>
  recorded.y6ExitItems.map((i) => {
    const at = i.question.indexOf(" (A) ");
    if (at === -1)
      return {
        objective: i.objective + 1,
        form: "apply" as const,
        question: i.question,
        answer: i.answer,
        wrongOptions: [],
      };
    const options = i.question
      .slice(at + 1)
      .split(/\s*\([A-D]\)\s*/)
      .filter(Boolean);
    const answer = i.answer.replace(/^\([A-D]\)\s*/, "");
    return {
      objective: i.objective + 1,
      form: "multiple-choice" as const,
      question: i.question.slice(0, at),
      answer,
      wrongOptions: options.filter((o) => o !== answer),
    };
  });

const INPUT: Omit<ExitItemsInput, "count" | "redo"> = {
  audience: { yearGroup: "Year 6", subject: "Maths" } as unknown as ExitItemsInput["audience"],
  topic: "Ratio",
  objectives: ["Interpret a ratio", "Solve ratio problems"],
  slides: [],
  asked: [],
};

describe("exit ticket size on S1 y6", () => {
  test("as recorded, the slide kept one item: the long first one crowded out the rest", () => {
    const w = closingQuestionsWritten(recorded.y6ExitItems);
    expect((w?.questions as unknown[] | undefined)?.length).toBe(1);
  });
  test("the long item is asked again shorter, not trimmed off, and three items reach the slide", async () => {
    const inputs: ExitItemsInput[] = [];
    const raw = y6Raw();
    const got = await modelExitItems(
      INPUT,
      async (input) => {
        inputs.push(input);
        if (!input.redo) return { items: raw };
        return {
          items: input.redo.map((r) => ({
            objective: r.objective,
            form: "multiple-choice" as const,
            question: "What does 5:2 tell you about the beads?",
            answer: "5 orange parts for every 2 purple",
            wrongOptions: ["5 orange and 2 purple beads", "2 orange parts for every 5"],
          })),
        };
      },
      { fits: (items) => items.length > 3 || closingFits(items) },
    );
    expect(inputs.length).toBe(2);
    expect(inputs[1]?.redo?.map((r) => r.objective)).toEqual([1]);
    expect(got?.items.length).toBe(3);
    expect(new Set(got?.items.map((i) => i.objective))).toEqual(new Set([0, 1]));
    expect(
      (closingQuestionsWritten(got?.items ?? [])?.questions as unknown[] | undefined)?.length,
    ).toBe(3);
  });
  test("an objective with no item is asked for, and the set is made up to three", async () => {
    const inputs: ExitItemsInput[] = [];
    const got = await modelExitItems(INPUT, async (input) => {
      inputs.push(input);
      if (!input.redo) return { items: [y6Raw()[1] as ExitItemsOutput["items"][number]] };
      return {
        items: input.redo.map((r, n) => ({
          objective: r.objective,
          form: "apply" as const,
          question: [
            "Write the ratio of 3 cats to 5 dogs.",
            "A recipe uses 2 eggs for every 7 spoons of flour. Which number comes first?",
          ][n] as string,
          answer: ["3:5", "2"][n] as string,
          wrongOptions: [],
        })),
      };
    });
    expect(inputs[1]?.redo?.map((r) => [r.objective, r.question])).toEqual([
      [1, ""],
      [1, ""],
    ]);
    expect(got?.items.length).toBe(3);
    expect(got?.items[0]?.objective).toBe(0);
  });
  test("the closing slide fills coverage first, then tops up", () => {
    const fresh = [
      {
        question: "What does a ratio of 3:1 compare?",
        answer: "Three parts to one part",
        shorter: [],
        objectiveRefs: ["o1"],
        form: "fact-question" as const,
        source: "o1",
        similarity: 0,
      },
    ] as unknown as Parameters<typeof coveringOrder>[1];
    const order = coveringOrder(recorded.y6ExitItems.slice(1), fresh, ["o1", "o2"]);
    expect(order.map((q) => q.question)).toEqual([
      "What does a ratio of 3:1 compare?",
      recorded.y6ExitItems[1]?.question ?? "",
      recorded.y6ExitItems[2]?.question ?? "",
    ]);
  });
});

/*
 * The reasoned-step bracket on what S1 recorded. The stream's own failing text was not logged (only
 * "the reason goes in brackets at the end of the step" on every step of y5 s7, y9 s5 and s10;
 * y6's maths steps never failed), so these are the steps the writer then gave for y9 s5 and s10,
 * each also as a worded step is written as a sentence, with a full stop after the bracket.
 */
const Y9_STEPS = [
  "Germany borrowed heavily to fund the First World War (this left debts to repay)",
  "Reparations added to the government's debts (Germany owed payments after the war)",
  "France and Belgium occupied the Ruhr in January 1923 (Germany had fallen behind on reparations)",
  "The government paid striking workers by printing marks (passive resistance stopped production)",
  "More marks bought fewer goods, so prices rose rapidly (the mark lost value)",
  "The Rentenmark began in November 1923 (limiting new money helped restore confidence)",
];

describe("reasoned-step bracket on S1 y9", () => {
  const schema = slideWriterSchema("worked-example", "default");
  const slide = (steps: string[]) => ({
    heading: "A chain of causes",
    question: "How did one event lead to the next?",
    steps,
    notes: "Reveal each step.",
  });
  test("the recorded steps pass, with or without a full stop after the bracket", () => {
    expect(schema.safeParse(slide(Y9_STEPS)).success).toBe(true);
    const got = schema.safeParse(slide(Y9_STEPS.map((s) => `${s}.`)));
    expect(got.success).toBe(true);
    // The full stop is taken off, so the reason column draws as before.
    expect((got.data as unknown as { steps: string[] }).steps).toEqual(Y9_STEPS);
  });
  test("a step with no bracketed reason at its end still fails", () => {
    const bad = [...Y9_STEPS.slice(0, 2), "Prices rose rapidly because the mark lost value."];
    expect(schema.safeParse(slide(bad)).success).toBe(false);
    expect(
      schema.safeParse(
        slide([...Y9_STEPS.slice(0, 2), "Prices rose (the mark lost value) quickly"]),
      ).success,
    ).toBe(false);
  });
});
