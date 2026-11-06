import { describe, expect, test } from "bun:test";
import { replayRun, replayServices } from "./replay-fixture";
import type { ChatReq, WriterServices } from "./services";

/*
 * The answer-key check through the real stage (`answer-key.ts`): a saved maths run whose first
 * practice slide is swapped for the Y9 equations slide of 3 Nov, where the notes keyed "Is x = 6 a
 * solution to 3x + 2 = 17?" as "Yes. … so x = 6 is not a solution." Only the model is replaced.
 */
const FIXTURE = "y5-maths-fractions-of-amounts";
const HEADING = "Solve and check";
const Q = [
  "Solve 5x + 4 = 24 and check by substitution.",
  "Solve x/3 + 2 = 7 and check by substitution.",
  "Is x = 6 a solution to 3x + 2 = 17? Check.",
];
const WRONG_YES =
  "Yes. Substitution gives 3 × 6 + 2 = 20, which is not 17; so x = 6 is not a solution.";
const RIGHT_NO =
  "No. Substitution gives 3 × 6 + 2 = 20, which is not 17; so x = 6 is not a solution.";

/** The saved writer text with its first practice slide replaced by the Y9 one. */
const withY9 = (itemAnswer3: string) => (text: string) => {
  const w = JSON.parse(text) as { slides: Record<string, unknown>[] };
  const j = w.slides.findIndex((s) => s.template === "practice");
  w.slides[j] = {
    template: "practice",
    heading: HEADING,
    picture: null,
    items: [
      { question: Q[0], answer: "x = 4", working: "24 − 4 = 20; 20 ÷ 5 = 4; 5 × 4 + 4 = 24" },
      { question: Q[1], answer: "x = 15", working: "7 − 2 = 5; 5 × 3 = 15; 15 ÷ 3 + 2 = 7" },
      { question: Q[2], answer: itemAnswer3, working: "3 × 6 + 2 = 20" },
    ],
  };
  return JSON.stringify(w);
};

/** Notes for every slide; the Y9 slide's answers from `deck` (deck-wide) or `redo` (one slide). */
function run(o: { item3: string; deck: string[]; redo?: string[] }) {
  const base = replayServices(FIXTURE);
  const logs: Record<string, unknown>[] = [];
  const calls: string[] = [];
  let onlyK = 0;
  const services: WriterServices = {
    ...base,
    log: (e) => {
      logs.push(e as Record<string, unknown>);
    },
    chat: async (r: ChatReq) => {
      if (r.name !== "notes") return base.chat(r);
      calls.push(r.user);
      const k = Number(r.user.match(new RegExp(`Slide (\\d+): ${HEADING}`))?.[1]);
      const only = Number(r.user.match(/slides only: (\d+)\.$/)?.[1] ?? 0);
      // The stage redoes this slide's note once itself (its words changed after the deck-wide
      // call); only a later call for it is the answer-key rewrite.
      if (only && only === k) onlyK++;
      const answers = only === k && onlyK > 1 ? (o.redo ?? o.deck) : o.deck;
      return {
        out: {
          slides: Array.from({ length: 20 }, (_, i) => ({
            n: i + 1,
            answers: i + 1 === k ? answers : null,
            misconceptions: null,
            background: null,
            run: null,
          })).filter((s) => !only || s.n === only),
        },
        usd: 0,
        ms: 0,
      };
    },
  };
  return replayRun(FIXTURE, { services, text: withY9(o.item3) }).then((out) => {
    const slide = out.slides.find((s) =>
      s.elements.some((e) => JSON.stringify(e).includes(Q[2] ?? "")),
    );
    const keyLogs = logs.filter((e) => String(e.ev).startsWith("answer-key"));
    return { slide, keyLogs, calls };
  });
}

describe("the answer-key check in the writer stage", () => {
  test("the Y9 notes' wrong yes is fixed in code, with no extra call", async () => {
    const r = await run({
      item3: "False: 20 ≠ 17",
      deck: ["x = 4; check: 5 × 4 + 4 = 24.", "x = 15; check: 15/3 + 2 = 7.", WRONG_YES],
    });
    expect(r.slide?.notes).toContain(`3. ${RIGHT_NO}`);
    expect(r.slide?.notes).not.toContain(WRONG_YES);
    expect(r.slide?.notes).toContain("1. x = 4; check: 5 × 4 + 4 = 24.");
    expect(r.keyLogs).toEqual([
      expect.objectContaining({
        ev: "answer-key",
        where: "notes",
        index: 2,
        kind: "yes-no",
        action: "fixed",
      }),
    ]);
  });

  test("a wrong solved value in the notes gets one rewrite of that note", async () => {
    const r = await run({
      item3: "False: 20 ≠ 17",
      deck: ["x = 5", "x = 15", "No: 20 ≠ 17"],
      redo: ["x = 4", "x = 15", "No: 20 ≠ 17"],
    });
    expect(r.slide?.notes).toContain("1. x = 4");
    expect(r.keyLogs.map((e) => e.ev)).toEqual(["answer-key-rewrite", "answer-key-rewritten"]);
    expect(r.keyLogs[1]).toMatchObject({ open: 0 });
  });

  test("a rewrite that is still wrong ships logged", async () => {
    const r = await run({ item3: "False: 20 ≠ 17", deck: ["x = 5", "x = 15", "No: 20 ≠ 17"] });
    expect(r.slide?.notes).toContain("1. x = 5");
    expect(r.keyLogs.at(-1)).toMatchObject({
      ev: "answer-key",
      kind: "solution",
      action: "shipped",
      level: "warn",
    });
  });

  test("the writer's own wrong yes is fixed on the slide's answers", async () => {
    const r = await run({ item3: WRONG_YES, deck: ["x = 4", "x = 15", "No: 20 ≠ 17"] });
    const q = r.slide?.question as { modelAnswer?: string } | undefined;
    expect(q?.modelAnswer).toContain(`3. ${RIGHT_NO}`);
    expect(r.keyLogs).toEqual([
      expect.objectContaining({ ev: "answer-key", where: "item", index: 2, action: "fixed" }),
    ]);
  });

  test("right keys are left alone and log nothing", async () => {
    const r = await run({ item3: "False: 20 ≠ 17", deck: ["x = 4", "x = 15", "No: 20 ≠ 17"] });
    expect(r.keyLogs).toEqual([]);
    expect(r.slide?.notes).toContain("3. No: 20 ≠ 17");
  });
});
