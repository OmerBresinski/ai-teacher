import { describe, expect, test } from "bun:test";
import { type ExitItemsInput, type ExitItemsOutput, exitItemsPrompt } from "../prompts/exit-items";
import { recomputeSums } from "./gates";
import { exitItemCount, modelExitItems, ordered, reviewItem } from "./model-exit";

const ASKED = [
  "What is the ratio of red to blue counters if there are 4 red and 6 blue?",
  "Simplify the ratio 6:9.",
];

const item = (
  over: Partial<ExitItemsOutput["items"][number]> = {},
): ExitItemsOutput["items"][number] => ({
  objective: 1,
  form: "explain",
  answer: "Divide both parts by their highest common factor.",
  question: "How do you know when a ratio cannot be simplified any further?",
  wrongOptions: [],
  ...over,
});

const BASE: Omit<ExitItemsInput, "count" | "redo"> = {
  audience: { yearGroup: "Year 6", subject: "Maths" } as unknown as ExitItemsInput["audience"],
  topic: "Ratio",
  objectives: ["Write a ratio", "Simplify a ratio", "Share in a ratio"],
  slides: [{ number: 3, form: "explain", written: { heading: "Ratios", body: "..." } }],
  asked: ASKED,
};

describe("recomputeSums", () => {
  test("puts a wrong result right when it appears once", () => {
    const r = recomputeSums("20 ÷ 5 = 5, so each share is 5 sweets.");
    expect(r.fixed).toBe(0);
    expect(r.unfixed.length).toBe(1);
    const s = recomputeSums("Total parts 2 + 3 = 6, then share 30.");
    expect(s.text).toBe("Total parts 2 + 3 = 5, then share 30.");
    expect(s.fixed).toBe(1);
  });
  test("leaves right sums and rounded results alone", () => {
    expect(recomputeSums("36 ÷ 3 = 12 km per hour.")).toEqual({
      text: "36 ÷ 3 = 12 km per hour.",
      fixed: 0,
      unfixed: [],
    });
    expect(recomputeSums("7 ÷ 3 = 2.33").unfixed).toEqual([]);
  });
});

describe("reviewItem", () => {
  test("keeps a new item and prints a multiple-choice key as a lettered option", () => {
    const v = reviewItem(
      item({
        form: "multiple-choice",
        answer: "3:4",
        question: "Which ratio is the same as 9:12?",
        wrongOptions: ["4:3", "9:3"],
      }),
      3,
      ASKED,
      [],
      0,
    );
    expect("item" in v).toBe(true);
    if (!("item" in v)) return;
    expect(v.item.question).toContain("(A)");
    expect(v.item.question).toContain("(C)");
    const letter = v.item.answer.slice(1, 2);
    expect(v.item.question).toContain(`(${letter}) 3:4`);
  });
  test("rejects a near-copy of an in-lesson question", () => {
    const v = reviewItem(item({ question: "Simplify the ratio 6:9" }), 3, ASKED, [], 0);
    expect("problem" in v && v.problem).toContain("too like the lesson's question");
  });
  test("rejects an unknown objective, a key among the wrong options, and too few options", () => {
    expect("problem" in reviewItem(item({ objective: 4 }), 3, ASKED, [], 0)).toBe(true);
    const mc = item({ form: "multiple-choice", answer: "2:3", wrongOptions: ["2:3", "3:2"] });
    expect("problem" in reviewItem(mc, 3, ASKED, [], 0)).toBe(true);
    const thin = item({ form: "multiple-choice", answer: "2:3", wrongOptions: ["3:2"] });
    expect("problem" in reviewItem(thin, 3, ASKED, [], 0)).toBe(true);
  });
  test("recomputes a wrong sum in the answer", () => {
    const v = reviewItem(
      item({ form: "apply", answer: "2 + 3 = 6 parts, so 30 ÷ 5 = 6 per part." }),
      3,
      ASKED,
      [],
      0,
    );
    // "6" appears twice, so the slip cannot be put right in place: it is asked again.
    expect("problem" in v && v.problem).toContain("2 + 3 = 5");
    const w = reviewItem(
      item({ form: "apply", answer: "2 + 3 = 4 parts in all." }),
      3,
      ASKED,
      [],
      0,
    );
    expect("item" in w && w.item.answer).toBe("2 + 3 = 5 parts in all.");
  });
});

describe("modelExitItems", () => {
  test("re-asks once for the failed items, then drops what still fails", async () => {
    const inputs: ExitItemsInput[] = [];
    const call = async (input: ExitItemsInput): Promise<ExitItemsOutput> => {
      inputs.push(input);
      if (!input.redo)
        return {
          items: [
            item({ objective: 1, question: "Why is 4:6 the same ratio as 2:3?" }),
            item({ objective: 2, question: "Simplify the ratio 6:9." }),
            item({ objective: 3, form: "apply", question: "Share 20 in the ratio 1:3." }),
          ],
        };
      return { items: [item({ objective: 2, question: "Simplify the ratio 6:9, please." })] };
    };
    const got = await modelExitItems(BASE, call);
    expect(inputs.length).toBe(2);
    expect(inputs[0]?.count).toBe(3);
    expect(inputs[1]?.redo?.map((r) => r.objective)).toEqual([2]);
    expect(got?.items.map((i) => i.objective)).toEqual([0, 2]);
    expect(got?.report).toMatchObject({ written: 3, reasked: 1, dropped: 1, kept: 2 });
  });
  test("a failed re-ask drops only its items; the first call's failure is the caller's", async () => {
    let n = 0;
    const got = await modelExitItems(BASE, async () => {
      n += 1;
      if (n > 1) throw new Error("timeout");
      return {
        items: [
          item({ objective: 1, question: "Why is 4:6 the same ratio as 2:3?" }),
          item({ objective: 9 }),
        ],
      };
    });
    expect(got?.items.length).toBe(1);
    await expect(
      modelExitItems(BASE, async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
  });
  test("undefined when nothing survives", async () => {
    const got = await modelExitItems(BASE, async () => ({ items: [item({ objective: 7 })] }));
    expect(got).toBeUndefined();
  });
});

describe("ordering and count", () => {
  test("3 to 4 items, coverage first", () => {
    expect([1, 2, 3, 4, 6].map(exitItemCount)).toEqual([3, 3, 3, 4, 4]);
    const mk = (objective: number, question: string) => ({
      question,
      answer: "a",
      objective,
      form: "explain" as const,
      similarity: 0,
    });
    const out = ordered([mk(0, "a1"), mk(0, "a2"), mk(1, "b1"), mk(2, "c1")], 3);
    expect(out.map((i) => i.question)).toEqual(["a1", "b1", "c1"]);
  });
  test("the prompt names the count, the lesson's questions and the re-ask", () => {
    const p = exitItemsPrompt({
      ...BASE,
      count: 3,
      redo: [{ objective: 2, form: "explain", question: "Q", problem: "too like" }],
    });
    expect(p.user).toContain("Items to write: 3");
    expect(p.user).toContain(`- ${ASKED[1]}`);
    expect(p.user).toContain("Write again only these items");
  });
});
