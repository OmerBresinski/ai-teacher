import { describe, expect, test } from "bun:test";
import recorded from "../fixtures/round-s2-recorded.json";
import type { ExitItemsInput, ExitItemsOutput } from "../prompts/exit-items";
import {
  closingFits,
  closingFitsAnyLayout,
  closingLayoutOf,
  EXIT_FORM,
  modelClosingWritten,
  worksheetPointerLine,
} from "./closing";
import { fitWritten } from "./fit";
import { modelExitItems } from "./model-exit";

/*
 * Round S2 (offline, on the stored y5-rivers lesson): an exit item that never fitted the slide was
 * dropped after its re-asks, leaving two items and objective 1 untested. The fallback now asks for
 * a compact form, then tries the closing slide's other layouts, then keeps the item on the
 * worksheet with a pointer on the slide. The model's replies are replayed as S2 logged them.
 */

type Raw = ExitItemsOutput["items"][number];
const [q901, q902] = recorded.kept;
const explain = (objective: number, question: string, answer: string): Raw => ({
  objective,
  form: "explain",
  question,
  answer,
  wrongOptions: [],
});
const LONG_O1 = explain(
  1,
  "If you walk upstream from a river’s mouth to its mountain source, which courses do you pass through in order and how do its channel and valley usually change?",
  "Lower, middle then upper course: the channel gets narrower and shallower and the valley narrower and steeper, ending in a V-shaped valley.",
);
const SHORTER_O1 = explain(
  1,
  "Walking from mouth to source, what is the course order and how do the channel and valley change?",
  LONG_O1.answer,
);
const MCQ_O2: Raw = {
  objective: 2,
  form: "multiple-choice",
  question: (q902?.stem ?? "").slice(0, (q902?.stem ?? "").indexOf(" (A) ")),
  answer: "Material breaks off the valley sides and moves downhill",
  wrongOptions: ["Deposition builds up the valley sides", "The river transports material uphill"],
};
/**
 * S2's replies: three items first, then each re-ask answered with an item on the same objective
 * that is still too long (objective 1's shorter stem never fitted beside the other two).
 */
const first: Raw[] = [explain(2, q901?.stem ?? "", q901?.answer ?? ""), MCQ_O2, LONG_O1];
const again = (o: number): Raw => (o === 1 ? SHORTER_O1 : MCQ_O2);

const input = {
  audience: { yearGroup: 5 } as unknown as ExitItemsInput["audience"],
  topic: "Rivers",
  objectives: recorded.objectives,
  slides: [],
  asked: [],
};

async function replay() {
  const sent: ExitItemsInput[] = [];
  const call = async (i: ExitItemsInput) => {
    sent.push(i);
    return { items: i.redo ? i.redo.map((r) => again(r.objective)) : first };
  };
  const got = await modelExitItems(input, call, {
    fits: (items) => items.length > 3 || closingFits(items),
    fitsAnyLayout: (items) => items.length > 3 || closingFitsAnyLayout(items),
  });
  return { got, sent };
}

describe("S2 y5 exit ticket: a non-fitting item is never dropped", () => {
  test("objective 1's recorded item does not fit the default layout beside the kept items", () => {
    const pair = recorded.kept.map((k) => ({ question: k.stem, answer: k.answer }));
    expect(closingFits(pair)).toBe(true);
    expect(
      closingFits([...pair, { question: SHORTER_O1.question, answer: SHORTER_O1.answer }]),
    ).toBe(false);
  });

  test("the re-ask asks for a compact form: a multiple-choice item comes back as short answer", async () => {
    const { sent } = await replay();
    const redo = sent.flatMap((s) => s.redo ?? []);
    const mcq = redo.find((r) => r.question === MCQ_O2.question);
    if (mcq) expect(mcq.form).toBe("explain");
    const o1 = redo.find((r) => r.objective === 1 && r.question !== "");
    expect(o1?.problem).toContain("more compact form");
    expect(o1?.problem).toContain("true-or-false");
    // No word or character limits in what the model is told.
    expect(o1?.problem).not.toMatch(/\d+ (words|characters)/);
  });

  test("three items, one per objective, none dropped", async () => {
    const { got } = await replay();
    expect(got).toBeDefined();
    const items = got?.items ?? [];
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(new Set(items.map((i) => i.objective))).toEqual(new Set([0, 1]));
    expect(got?.report.dropped).toBe(0);
    expect((got?.report.widerLayout ?? 0) + (got?.report.worksheetOnly ?? 0)).toBe(1);
  });

  test("the closing slide carries three, in a layout that holds them, or points to the worksheet", async () => {
    const items = (await replay()).got?.items ?? [];
    const written = modelClosingWritten(items, { items, fresh: [], objectiveIds: ["o1", "o2"] });
    const qs = (written?.questions ?? []) as { question: string }[];
    const line = worksheetPointerLine(items);
    // Every item reaches the slide: as a question, or by the line pointing to the worksheet.
    expect(qs.length + (line ? items.filter((i) => i.worksheetOnly).length : 0)).toBe(3);
    const layout = closingLayoutOf(written ?? {});
    expect(fitWritten(EXIT_FORM, layout, written ?? {}).ok).toBe(true);
    const o1 = items.findIndex((i) => i.objective === 0);
    const onWorksheet = items[o1]?.worksheetOnly === true;
    expect(qs.some((q) => q.question === items[o1]?.question)).toBe(!onWorksheet);
    for (const [n, i] of items.entries())
      if (i.worksheetOnly) expect(line).toBe(`See the worksheet for question ${n + 1}.`);
  });

  test("an item too long for every layout is kept on the worksheet, the slide pointing to it", async () => {
    const huge = explain(
      1,
      `${LONG_O1.question} ${LONG_O1.question} ${LONG_O1.question}`,
      LONG_O1.answer,
    );
    const call = async (i: ExitItemsInput) => ({
      items: i.redo
        ? i.redo.map((r) => (r.objective === 1 ? huge : MCQ_O2))
        : [explain(2, q901?.stem ?? "", q901?.answer ?? ""), MCQ_O2, huge],
    });
    const got = await modelExitItems(input, call, {
      fits: (items) => items.length > 3 || closingFits(items),
      fitsAnyLayout: (items) => items.length > 3 || closingFitsAnyLayout(items),
    });
    const items = got?.items ?? [];
    expect(items.length).toBe(3);
    const at = items.findIndex((i) => i.worksheetOnly);
    expect(items[at]?.objective).toBe(0);
    expect(got?.report.dropped).toBe(0);
    const written = modelClosingWritten(items, { items, fresh: [], objectiveIds: ["o1", "o2"] });
    const qs = (written?.questions ?? []) as { question: string }[];
    expect(worksheetPointerLine(items)).toBe(`See the worksheet for question ${at + 1}.`);
    expect(qs.length).toBe(2);
    expect(qs.some((q) => q.question === huge.question)).toBe(false);
  });
});
