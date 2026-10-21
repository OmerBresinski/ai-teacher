import { describe, expect, test } from "bun:test";
import { activityDefs, activityMenu, elementText, fromWriterActivity } from "./activities";
import { WRITER_BUNDLES } from "./bundle";
import { ANSWER_FIRST, answerFirstMenu, PINNED_LINES } from "./contract";
import {
  answerFirst,
  answerFirstMain,
  type Brief,
  keepAnswerKey,
  shuffleHinge,
  toAnswerFirst,
  withoutHingeKey,
} from "./fixes";
import fixture from "./fixtures/activities/y1-animals.json" with { type: "json" };
import proof from "./fixtures/answer-key/proof-hinges.json" with { type: "json" };
import { type WriterStage, writerSchema } from "./schema";
import type { WriterServices } from "./services";
import { runWriter, writerSystem } from "./stage";

/*
 * Answer first (hotfix, pilot build/ANSWER-BUG.md). gpt-6.1-sol wrote the single-answer key
 * `correct` counting from 0 while code read it from 1, so live lessons ticked a distractor. The
 * writer now puts the answer first and writes no index; code fixes the key at 1 and the seeded
 * shuffles place it. The three proof hinges below are the master writer's own outputs.
 */

type S = Record<string, unknown>;
type J = Record<string, unknown>;
const STAGES: WriterStage[] = ["KS1", "KS2", "KS3-5"];
const ticked = (s: S) => (s.options as string[])[Number(s.correct) - 1];
const hinges = proof.hinges as { brief: string; raw: S; intended: string }[];
/** The proof hinge as the answer-first writer is asked to write it: the intended option first. */
const asked = (h: { raw: S; intended: string }): S => {
  const { correct: _, ...rest } = h.raw;
  const opts = h.raw.options as string[];
  return { ...rest, options: [h.intended, ...opts.filter((o) => o !== h.intended)] };
};

describe("the key", () => {
  test("a keyed slide with no `correct` gets key 1; a saved one keeps its own", () => {
    for (const template of ["hinge", "choose", "odd-one-out"])
      expect(answerFirst({ template }).correct).toBe(1);
    expect(answerFirst({ template: "hinge", correct: 3 }).correct).toBe(3);
    expect(answerFirst({ template: "explain" })).toEqual({ template: "explain" });
  });

  test("the shuffle carries the first option's key to wherever it lands, for every seed", () => {
    const s = answerFirst({ template: "hinge", options: ["right", "w1", "w2", "w3"] });
    const at = new Set<number>();
    for (let k = 0; k < 200; k++) {
      const out = shuffleHinge(s, `seed-${k}`);
      expect(ticked(out)).toBe("right");
      at.add(Number(out.correct));
    }
    // The answer does not stay at A: it reaches every position.
    expect([...at].sort()).toEqual([1, 2, 3, 4]);
  });

  test("a repaired hinge's key follows the answer's words, never the repair's own number", () => {
    const before = { template: "hinge", options: ["Veins", "Blood", "Air"], correct: 2 };
    // Reworded in place, the repair's own `correct` ignored.
    expect(
      keepAnswerKey(before, { ...before, options: ["Veins", " blood ", "Air"], correct: 1 }),
    ).toMatchObject({ correct: 2 });
    // Reordered: the key moves with the answer.
    expect(keepAnswerKey(before, { ...before, options: ["Air", "Veins", "Blood"] })?.correct).toBe(
      3,
    );
    // A different count: found by its words.
    expect(
      keepAnswerKey(before, { ...before, options: ["Blood", "Air"], correct: 2 })?.correct,
    ).toBe(1);
    // The answer is gone (or the slide is no longer a hinge): null, the caller keeps the old slide.
    expect(keepAnswerKey(before, { ...before, options: ["Veins", "Air"] })).toBeNull();
    expect(keepAnswerKey(before, { template: "explain", points: ["x"] })).toBeNull();
    expect(keepAnswerKey({ template: "explain" }, { template: "hinge" })).toBeNull();
    expect(keepAnswerKey({ template: "explain" }, { template: "steps" })).toEqual({
      template: "steps",
    });
  });

  test("the repair schema asks for no hinge key, at every stage", () => {
    for (const b of Object.values(WRITER_BUNDLES))
      for (const s of [b.repairSchemaKS1, b.repairSchemaKS2, b.repairSchemaKS3_5]) {
        const hinge = (withoutHingeKey(JSON.parse(s)).$defs as Record<string, J>).hinge as J;
        expect(Object.keys(hinge.properties as J)).not.toContain("correct");
        expect(hinge.required).not.toContain("correct");
      }
  });

  test("toAnswerFirst moves the keyed item to the front and drops the index", () => {
    expect(toAnswerFirst({ template: "hinge", options: ["a", "b", "c"], correct: 3 })).toEqual({
      template: "hinge",
      options: ["c", "a", "b"],
    });
    const c = toAnswerFirst({
      template: "choose",
      cards: [{ label: "x" }, { label: "y" }],
      correct: 2,
    });
    expect(c).toEqual({ template: "choose", cards: [{ label: "y" }, { label: "x" }] });
  });

  test("a choose or odd-one-out with no `correct` marks its first card", () => {
    const main = answerFirstMain(fixture.main) as { slides: S[] };
    for (const [i, want] of [
      [6, "chick"],
      [7, "cow"],
    ] as const) {
      const raw = main.slides[i] as S;
      expect(raw.correct).toBeUndefined();
      const { slide } = fromWriterActivity(raw, "KS1");
      const cards = slide.cards as { text: string }[];
      expect(cards[Number(slide.correct) - 1]?.text).toBe(want);
    }
  });
});

describe("what the writer is asked", () => {
  test("no single-answer def asks for a counted key; each says the answer comes first", () => {
    for (const st of STAGES) {
      const hinge = (writerSchema(st, { min: 9, max: 12 }).$defs as Record<string, J>).hinge as J;
      expect(Object.keys(hinge.properties as J)).not.toContain("correct");
      expect(hinge.required).not.toContain("correct");
      expect(((hinge.properties as J).options as J).description).toBe(ANSWER_FIRST.options);
      const acts = activityDefs(st);
      for (const id of ["choose", "odd-one-out"]) {
        const d = acts[id] as J;
        expect(Object.keys(d.properties as J)).not.toContain("correct");
        expect(((d.properties as J).cards as J).description).toBeString();
      }
    }
  });

  test("every bundle's system text and menu carry the answer-first lines, not the counted ones", () => {
    for (const b of Object.values(WRITER_BUNDLES))
      for (const keyStage of ["ks1", "ks2", "ks4"] as const) {
        const sys = writerSystem({ ...(fixture.brief as unknown as Brief), keyStage }, b);
        expect(sys).toContain(ANSWER_FIRST.hingeKey);
        expect(sys).not.toContain("the number of the correct option");
        expect(sys).not.toContain(PINNED_LINES.hingeKey);
      }
    for (const b of Object.values(WRITER_BUNDLES)) {
      const menu = answerFirstMenu(b.activityMenu);
      expect(menu).toContain("the correct card written first");
      expect(menu).toContain("written as the first card");
    }
    expect(activityMenu("KS1")).toContain("the correct card written first");
  });
});

describe("replay of the proof's hinges (master writer, 13 Oct)", () => {
  test("as Sol wrote them, the 1-based read ticks a wrong option on all three (the bug)", () => {
    for (const h of hinges) expect(ticked(h.raw)).not.toBe(h.intended);
  });

  test("written answer first, the shuffled slide ticks the intended option", () => {
    for (const h of hinges) {
      const out = shuffleHinge(answerFirst(asked(h)), `${h.brief}:9:${String(h.raw.stem)}`);
      expect(ticked(out)).toBe(h.intended);
    }
  });

  test("through the whole writer stage, the laid-out question marks the intended option", async () => {
    for (const h of hinges) {
      const main = answerFirstMain(fixture.main) as { slides: S[] };
      main.slides[2] = asked(h);
      const services: WriterServices = {
        log: () => {},
        writer: async () =>
          ({ text: JSON.stringify(main), usd: 0, ms: 1, finishReason: "stop" }) as never,
        chat: async () => {
          throw new Error("no notes in this run");
        },
      };
      const out = await runWriter({
        brief: fixture.brief as unknown as Brief,
        objectives: fixture.objectives,
        services,
        pupilWording: false,
      });
      const slide = out.slides.find((s) => s.question?.type === "multiple-choice");
      const right = (
        (slide?.question as { options?: { id: string; correct: boolean }[] } | undefined)
          ?.options ?? []
      ).filter((o) => o.correct);
      expect(right.length).toBe(1);
      // The option's id is its box; its words are the "Option text" element inside the box.
      type Box = { id: string; name?: string; x: number; y: number; w: number; h: number };
      const els = (slide?.elements ?? []) as unknown as Box[];
      const box = els.find((e) => e.id === right[0]?.id);
      const words = els.filter(
        (e) =>
          box &&
          e.name === "Option text" &&
          e.x >= box.x &&
          e.y >= box.y &&
          e.x + e.w <= box.x + box.w &&
          e.y + e.h <= box.y + box.h,
      );
      expect(words.length).toBe(1);
      expect(elementText(words[0] as never)).toBe(h.intended);
    }
  });
});
