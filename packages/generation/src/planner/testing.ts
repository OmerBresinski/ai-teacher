import type { FakeCall } from "@tj/ai";
import { createFakeAi, type FakeScriptEntry } from "@tj/ai/testing";
import type { Lesson } from "@tj/domain/documents";
import romans from "../fixtures/objective-facts.y4-history-romans.json";
import { FIXTURES, sampleBriefLesson } from "../testing";

/*
 * Test helpers for the objectives-first planner (TEACH-91, TEACH-93): a fake answering every call
 * of the planner and the stages after it by prompt version, whatever the order calls arrive in,
 * from the Romans fixture (`fixtures/objective-facts.y4-history-romans.json`) sliced back into the
 * per-objective answers the merge takes. Used by the planner's, the workflow's and the worker's
 * tests; never by production code.
 */

const json = (v: unknown) => JSON.stringify(v);
const usage = { inputTokens: 1000, outputTokens: 400 };

export function romansLesson(): Lesson {
  return sampleBriefLesson({
    title: romans.topic,
    subject: romans.subject,
    yearGroup: romans.yearGroup,
    ageBand: "ks2",
    brief: { topic: romans.topic, durationMin: romans.durationMin, answers: romans.answers },
  } as Partial<Lesson>);
}

type Item = { objectiveRefs?: { type: string; index: number }[]; misconceptionRef?: unknown };
const has = (x: Item, i: number) => (x.objectiveRefs ?? []).some((r) => r.index === i);
const strip = <T extends Item>(x: T) => {
  const { objectiveRefs: _o, misconceptionRef: _m, ...rest } = x as Item & T;
  return rest;
};

/**
 * The fixture's merged facts as the answer objective `i` would have given: no objective refs on
 * the lists that never carry them, no misconception ordinals (the merge re-indexes those), and
 * the v9 declarations a call makes — a worked example names its objective, a question declares
 * `demand` and `forms` — filled from the fixture where it has them and by their native form
 * where it does not (a fixture written before v9).
 */
export function factsAnswerFor(i: number) {
  const f = romans.facts;
  return {
    keyIdeas: f.keyIdeas.filter((x) => has(x, i)).map(strip),
    misconceptions: f.misconceptions.filter((x) => has(x, i)).map(strip),
    vocabulary: f.vocabulary.filter((x) => has(x, i)).map(strip),
    // The one worked example goes to the last objective: the reach carries it (v4 of the prompt).
    workedExamples: (i === romans.objectives.length - 1 ? f.workedExamples : []).map((x) => ({
      ...strip(x),
      objectiveRefs: [{ type: "objective" as const, index: i }],
    })),
    questions: f.questions
      .filter((x) => has(x, i))
      .map((q) => {
        const declared = q as { demand?: string; forms?: string[] };
        return {
          ...strip(q),
          demand: declared.demand ?? "recall",
          forms:
            declared.forms ??
            ((q.distractors ?? []).length >= 3 ? ["multiple-choice"] : ["open-response"]),
          distractors: (q.distractors ?? []).map(strip),
        };
      }),
  };
}

/** A question set as the split call returns one: `count` questions, each on the taught key idea 0. */
export function questionSetAnswer(
  set: { target: number; use: "slide" | "exit"; count: number },
  keyIdeaIndex = 0,
) {
  return {
    questions: Array.from({ length: set.count }, (_, n) => ({
      stem: `${set.use} question ${n + 1} on objective ${set.target + 1}: which is right?`,
      answer: `Right answer ${n + 1}`,
      reasoning: "The taught key idea says so.",
      tier: n === 0 ? "easy" : n === 1 ? "core" : "stretch",
      use: set.use,
      demand: "recall",
      forms: ["multiple-choice", "open-response"],
      keyIdeaRefs: [{ type: "keyIdea", index: keyIdeaIndex }],
      distractors: [
        { text: `Wrong option ${n + 1}a` },
        { text: `Wrong option ${n + 1}b` },
        { text: `Wrong option ${n + 1}c` },
      ],
    })),
  };
}

/** A fake answering by prompt version, whatever the order calls arrive in. */
export function labAi(
  options: {
    objectives?: unknown;
    /** The objectives answer per call (1-based), when it should change between attempts. */
    objectivesAt?: (n: number) => unknown;
    /** The objectives call's retrieval set (v12); omitted: an answer without one, as v11 gave. */
    retrieval?: unknown;
    facts?: (call: FakeCall, target: number) => string | Promise<string>;
    /** Lab pw: the teach call's answer (default the fixture slice without its questions). */
    teach?: (call: FakeCall, target: number) => string | Promise<string>;
    /** Lab pw: a question set's answer (default `count` questions on key idea 0). */
    questionSet?: (
      call: FakeCall,
      set: { target: number; use: "slide" | "exit"; count: number },
    ) => string | Promise<string>;
    verify?: unknown;
    /** The slide answer; default the fixture slide of the entry's kind. */
    slide?: (call: FakeCall, kind: string) => string;
    evaluate?: unknown;
    /** The input check's answer (default: no findings). */
    checkInput?: unknown;
  } = {},
) {
  let objectivesCalls = 0;
  const fallback: FakeScriptEntry = async (call) => {
    const version = call.context?.promptVersion ?? "";
    if (version.startsWith("check-input")) return json(options.checkInput ?? { findings: [] });
    if (version.startsWith("plan-objectives"))
      return json({
        objectives:
          options.objectivesAt?.(++objectivesCalls) ?? options.objectives ?? romans.objectives,
        ...(options.retrieval === undefined ? {} : { retrieval: options.retrieval }),
      });
    if (version.startsWith("plan-facts-objective")) {
      // The prompt (v9) lists objectives by 0-based index and names the target the same way.
      const target = Number(/Write the facts for objective (\d+)/.exec(call.promptText)?.[1]);
      return options.facts ? options.facts(call, target) : json(factsAnswerFor(target));
    }
    if (version.startsWith("plan-teach-objective")) {
      const target = Number(/for objective (\d+):/.exec(call.promptText)?.[1]);
      if (options.teach) return options.teach(call, target);
      const { questions: _questions, ...taught } = factsAnswerFor(target);
      return json(taught);
    }
    if (version.startsWith("plan-question-set")) {
      const m = /Write (\d+) "(slide|exit)" question/.exec(call.promptText);
      const count = Number(m?.[1]);
      const use = m?.[2] as "slide" | "exit";
      const target = romans.objectives.findIndex((o) => call.promptText.includes(o.text));
      if (options.questionSet) return options.questionSet(call, { target, use, count });
      return json(questionSetAnswer({ target, use, count }));
    }
    if (version.startsWith("verify-facts")) return json(options.verify ?? { corrections: [] });
    if (version.startsWith("generate-slide")) {
      const kind = /kind "([a-z-]+)"/.exec(call.promptText)?.[1] ?? "content";
      if (options.slide) return options.slide(call, kind);
      return json(FIXTURES.slides[kind as keyof typeof FIXTURES.slides]);
    }
    if (version.startsWith("evaluate")) return json(options.evaluate ?? { findings: [] });
    if (version.startsWith("repair")) return json(FIXTURES.repair);
    throw new Error(`unexpected call: ${version}`);
  };
  return createFakeAi({ fallback, usage });
}

export const versionsOf = (ai: ReturnType<typeof labAi>) =>
  ai.calls.map((c) => (c.context?.promptVersion ?? "").replace(/\.v\d+$/, ""));
