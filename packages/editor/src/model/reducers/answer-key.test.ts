import { describe, expect, test } from "bun:test";
import { answerKeyText, type QuestionData } from "@tj/domain/documents";
import { withAnswerKey } from "./question";

/*
 * The answer drawer shows and edits the answer key as one text, "answer — working" per line, as it
 * did when the two were one string. Saving splits it back into `modelAnswer` and `working` line by
 * line, so deleting or reordering lines keeps each working with its own answer.
 */
type Open = Extract<QuestionData, { type: "open-response" }>;
const SENTENCE = "Halving both halves makes four equal groups, so half of one half is a quarter.";
const Q: Open = {
  type: "open-response",
  modelAnswer: `1. 10 crayons\n2. 6 beads\n3. ${SENTENCE}`,
  working: ["20 ÷ 2 = 10", "24 ÷ 4 = 6", ""],
};
const SHOWN = `1. 10 crayons — 20 ÷ 2 = 10\n2. 6 beads — 24 ÷ 4 = 6\n3. ${SENTENCE}`;

describe("the answer drawer's text keeps each working with its answer", () => {
  test("the drawer shows the joined text it showed before", () => {
    expect(answerKeyText(Q)).toBe(SHOWN);
  });

  test("saving the text unchanged keeps the fields", () => {
    expect(withAnswerKey(Q, SHOWN)).toEqual(Q);
  });

  test("deleting a line takes its working with it", () => {
    const lines = SHOWN.split("\n");
    const q = withAnswerKey(Q, [lines[1], lines[2]].join("\n"));
    expect(q.modelAnswer).toBe(`2. 6 beads\n3. ${SENTENCE}`);
    expect(q.working).toEqual(["24 ÷ 4 = 6", ""]);
  });

  test("reordering lines moves each working with its answer", () => {
    const [a, b, c] = SHOWN.split("\n");
    const q = withAnswerKey(Q, [c, b, a].join("\n"));
    expect(q.modelAnswer).toBe(`3. ${SENTENCE}\n2. 6 beads\n1. 10 crayons`);
    expect(q.working).toEqual(["", "24 ÷ 4 = 6", "20 ÷ 2 = 10"]);
  });

  test("deleting the last working drops the field", () => {
    const q = withAnswerKey(Q, `1. 10 crayons\n3. ${SENTENCE}`);
    expect(q).toEqual({ type: "open-response", modelAnswer: `1. 10 crayons\n3. ${SENTENCE}` });
  });

  test("what the teacher is typing comes back exactly, trailing space and new line included", () => {
    for (const typed of ["1. 8 counters — 16 ", "1. 8 counters — ", "1. 8 counters —", "1. 8\n"])
      expect(answerKeyText(withAnswerKey(Q, typed))).toBe(typed);
  });

  test("a sentence's own dash stays in the answer; a calculation after it is working", () => {
    const prose = "It compares distance with time — so both units show.";
    expect(withAnswerKey(Q, prose)).toEqual({ type: "open-response", modelAnswer: prose });
    const q = withAnswerKey(Q, `${SENTENCE} — 16 ÷ 2 = 8; 8 ÷ 2 = 4`);
    expect(q).toEqual({
      type: "open-response",
      modelAnswer: SENTENCE,
      working: ["16 ÷ 2 = 8; 8 ÷ 2 = 4"],
    });
  });

  test("a lesson saved with the joined text shows it unchanged", () => {
    const old: Open = { type: "open-response", modelAnswer: SHOWN };
    expect(answerKeyText(old)).toBe(SHOWN);
    expect(answerKeyText(withAnswerKey(old, SHOWN))).toBe(SHOWN);
  });
});
