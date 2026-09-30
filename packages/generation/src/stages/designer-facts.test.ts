import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { type Lesson, LessonFactsSchema } from "@tj/domain/documents";
import pino from "pino";
import { designCycleAnswer, factsAnswerFor, labAi, romansLesson } from "../planner/testing";
import { designCyclePrompt, factsFeedBlock } from "../prompts/design-cycle";
import type { PlanTeachObjectiveOutput } from "../prompts/plan-teach-objective";
import { recordingDeps } from "../testing";
import { runLessonPipeline } from "../workflow";
import {
  contentWords,
  correctedSlots,
  correctedText,
  cycleFactsOf,
  designerFactsOn,
  taughtAsLessonFacts,
} from "./designer-facts";

const romans = (slideCount: 10 | 12): Lesson => {
  const lesson = romansLesson();
  return { ...lesson, brief: { ...(lesson.brief as NonNullable<Lesson["brief"]>), slideCount } };
};

const taught = (): PlanTeachObjectiveOutput => {
  const { questions: _q, ...rest } = factsAnswerFor(0);
  return rest as unknown as PlanTeachObjectiveOutput;
};
const objectives = [
  { id: "o1", text: "Explain why the Romans built forts" },
  { id: "o2", text: "Describe Roman roads" },
];

describe("facts feed helpers", () => {
  test("the flag is DESIGNER_FACTS=1 and nothing else", () => {
    expect(designerFactsOn({ DESIGNER_FACTS: "1" })).toBe(true);
    expect(designerFactsOn({ DESIGNER_FACTS: "0" })).toBe(false);
    expect(designerFactsOn({})).toBe(false);
  });

  test("a teach output becomes valid LessonFacts on its objective, and back to the cycle's lists", () => {
    const t = taught();
    const facts = taughtAsLessonFacts(t, objectives, 1, 60);
    expect(LessonFactsSchema.safeParse(facts).success).toBe(true);
    expect(facts.keyIdeas?.[0]?.id).toBe("k1");
    expect(facts.keyIdeas?.every((k) => k.objectiveRefs[0] === "o2")).toBe(true);
    const cycle = cycleFactsOf(facts);
    expect(cycle.keyIdeas.map((k) => k.statement)).toEqual(t.keyIdeas.map((k) => k.statement));
    expect(cycle.vocabulary).toHaveLength(t.vocabulary.length);
  });

  test("the text a correction replaced is read from the facts before it", () => {
    const facts = taughtAsLessonFacts(taught(), objectives, 0, 60);
    const before = facts.keyIdeas?.[0]?.statement;
    expect(
      correctedText(facts, { factId: "k1", field: "statement", value: "x", reason: "invented" }),
    ).toBe(before as string);
    expect(
      correctedText(facts, { factId: "k9", field: "statement", value: "x", reason: "invented" }),
    ).toBeUndefined();
  });

  test("a correction reaches only the slots that carry a word it took out", () => {
    expect([...contentWords("The wall was built in AD 122.")]).toEqual(["wall", "built", "122"]);
    const slots = [
      { key: 3, material: "Hadrian's Wall was begun in AD 122 across Britain." },
      { key: 4, material: "Soldiers lived in forts along the wall." },
      { key: 5, material: "True or false: the wall was begun in AD 122." },
    ];
    expect(
      correctedSlots(
        [
          {
            before: "The wall was begun in AD 122.",
            after: "The wall was begun in AD 122 or 123.",
          },
        ],
        slots,
      ),
    ).toEqual([]);
    expect(
      correctedSlots(
        [{ before: "The wall was begun in AD 122.", after: "The wall was begun in AD 128." }],
        slots,
      ),
    ).toEqual([3, 5]);
    // A word the corrected facts still say elsewhere reaches no slot on its own.
    expect(
      correctedSlots(
        [{ before: "Forts lined the wall in AD 122.", after: "Forts lined the wall from AD 128." }],
        slots,
        new Set(["122"]),
      ),
    ).toEqual([]);
  });

  test("the cycle's user turn carries the facts as a plain block, and is unchanged without them", () => {
    const facts = cycleFactsOf(taughtAsLessonFacts(taught(), objectives, 0, 60));
    const block = factsFeedBlock(facts).join("\n");
    expect(block).toContain(`Key idea 1: ${facts.keyIdeas[0]?.statement}`);
    expect(designCyclePrompt.system).not.toContain("Source for objective");
  });
});

describe("the designer with DESIGNER_FACTS=1", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.DESIGNER_FACTS;
    process.env.DESIGNER_FACTS = "1";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DESIGNER_FACTS;
    else process.env.DESIGNER_FACTS = saved;
  });

  test("one teach call per objective, each cycle after its own facts and handed them; Verify per objective", async () => {
    const ai = labAi();
    const lines: { msg: string; factsFeed?: { teachMs?: number; verifyMs?: number }[] }[] = [];
    const logger = pino(
      { level: "info" },
      new Writable({
        write(chunk, _e, cb) {
          for (const l of chunk.toString().split("\n").filter(Boolean)) lines.push(JSON.parse(l));
          cb();
        },
      }),
    );
    const deps = recordingDeps(ai, { logger });
    const final = await runLessonPipeline({ lesson: romans(10) }, deps, { planner: "designer" });
    expect(final.lesson.slides).toHaveLength(10);
    const calls = ai.calls.map((c) => ({
      v: c.context?.promptVersion ?? "",
      text: c.promptText,
    }));
    const teach = calls.filter((c) => c.v.startsWith("plan-teach-objective"));
    const cycles = calls.filter((c) => c.v.startsWith("design-cycle"));
    expect(teach).toHaveLength(3);
    expect(cycles).toHaveLength(3);
    // No question sets: the designer writes its own checks.
    expect(calls.some((c) => c.v.startsWith("plan-question-set"))).toBe(false);
    for (const [i, c] of cycles.entries()) {
      const target = Number(/Design objective (\d+)/.exec(c.text)?.[1]) - 1;
      expect(c.text).toContain("Source for objective");
      const statement = factsAnswerFor(target).keyIdeas[0]?.statement as string;
      expect(c.text).toContain(statement);
      // Its facts call was made before it.
      const teachAt = ai.calls.findIndex(
        (x) =>
          x.context?.promptVersion?.startsWith("plan-teach-objective") &&
          x.promptText.includes(`for objective ${target}:`),
      );
      const cycleAt = ai.calls.findIndex((x) => x.promptText === cycles[i]?.text);
      expect(teachAt).toBeGreaterThanOrEqual(0);
      expect(teachAt).toBeLessThan(cycleAt);
    }
    // Verify: once per objective's facts, then once over the designed deck.
    expect(calls.filter((c) => c.v.startsWith("verify-facts"))).toHaveLength(4);
    const feed = final.designReport?.timings?.factsFeed;
    expect(feed).toHaveLength(3);
    for (const f of feed ?? []) {
      expect(f.teachMs).toBeGreaterThanOrEqual(0);
      expect(f.verifyMs).toBeGreaterThanOrEqual(0);
      expect(f.refilled).toEqual([]);
    }
    expect(lines.some((l) => l.msg === "designer facts feed latency")).toBe(true);
  });

  test("without the flag the designer makes no teach call", async () => {
    delete process.env.DESIGNER_FACTS;
    const ai = labAi();
    await runLessonPipeline({ lesson: romans(10) }, recordingDeps(ai), { planner: "designer" });
    expect(ai.calls.some((c) => c.context?.promptVersion?.startsWith("plan-teach"))).toBe(false);
    expect(ai.calls.some((c) => c.promptText.includes("Source for objective"))).toBe(false);
  });

  test("a Verify correction re-fills only the slots that said what it took out, from the corrected facts", async () => {
    const wrong = "Hadrian's Wall was begun in AD 199.";
    const ai = labAi({
      teach: (_call, target) => {
        const { questions: _q, ...rest } = factsAnswerFor(target);
        const first = rest.keyIdeas[0] as { statement: string };
        if (target === 0) first.statement = wrong;
        return JSON.stringify(rest);
      },
      verify: {
        corrections: [
          {
            factId: "k1",
            field: "statement",
            value: "Hadrian's Wall was begun in AD 122.",
            reason: "invented",
          },
        ],
      },
      designCycle: (call, target, count) => {
        const answer = designCycleAnswer(target, count);
        // Objective 1's first slot repeats its first key idea word for word; nothing else does.
        if (target === 0 && count > 1 && !call.promptText.includes("This slot replaces")) {
          const first = answer.slots[0] as { body?: string };
          first.body = wrong;
        }
        return JSON.stringify(answer);
      },
    });
    const final = await runLessonPipeline({ lesson: romans(10) }, recordingDeps(ai), {
      planner: "designer",
    });
    const refills = ai.calls.filter((c) => c.promptText.includes("This slot replaces"));
    const factsRefills = refills.filter((c) => c.promptText.includes("a fact it used was wrong"));
    expect(factsRefills).toHaveLength(1);
    expect(factsRefills[0]?.promptText).toContain("AD 122");
    expect(factsRefills[0]?.promptText).toContain("Source for objective");
    expect(factsRefills[0]?.promptText).toContain("Design objective 1:");
    const feed = final.designReport?.timings?.factsFeed ?? [];
    expect(feed[0]?.corrections).toBe(1);
    expect(feed[0]?.refilled).toEqual([4]);
    expect(feed[1]?.refilled).toEqual([]);
    expect(final.lesson.slides).toHaveLength(10);
  });
});
