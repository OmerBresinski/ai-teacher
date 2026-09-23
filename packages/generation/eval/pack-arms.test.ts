import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { Lesson } from "@tj/domain/documents";
import romans from "../src/fixtures/objective-facts.y4-history-romans.json";
import { labPlan } from "../src/lab/plan-pipeline";
import { planFactsObjectivePrompt } from "../src/prompts/plan-facts-objective";
import { planObjectivesPrompt } from "../src/prompts/plan-objectives";
import { lessonShapeOf } from "../src/shapes";
import { recordingDeps, sampleBriefLesson } from "../src/testing";
import {
  armHooks,
  fillTypesFor,
  outcomesText,
  referenceText,
  retarget,
  type SelectRecord,
} from "./pack-arms";
import { packFillPrompt, packSelectPrompt } from "./packs/prompts";
import type { Pack, PackSection } from "./packs/schema";

/*
 * The three arms as hooks, with the select and fill calls faked: which objectives take the
 * pack, which take a call with reference text, which fill, and — through `labPlan` itself — that
 * the pack's outcomes reach the objectives call and a fully covered lesson makes no facts call.
 */

const url = "https://en.wikipedia.org/wiki/Roman_Britain";
const ev = [{ url, sentenceIds: ["s1.1"], snippet: "Romans" }];
type Item = { objectiveRefs?: { type: string; index: number }[]; misconceptionRef?: unknown };
const has = (x: Item, i: number) => (x.objectiveRefs ?? []).some((r) => r.index === i);
const strip = <T extends Item>(x: T) => {
  const { objectiveRefs: _o, misconceptionRef: _m, ...rest } = x as Item & T;
  return rest;
};

/** The Romans fixture's facts for objective `i` as a pack section (dummy evidence on every fact). */
function sectionFor(i: number): PackSection {
  const f = romans.facts;
  const last = i === romans.objectives.length - 1;
  return {
    id: `sec${i + 1}`,
    outcome: romans.objectives[i]?.text ?? "",
    sentenceIds: ["s1.1"],
    facts: {
      keyIdeas: f.keyIdeas.filter((x) => has(x, i)).map((x) => ({ ...strip(x), evidence: ev })),
      misconceptions: f.misconceptions
        .filter((x) => has(x, i))
        .map((x) => ({ ...strip(x), evidence: ev })),
      vocabulary: f.vocabulary
        .filter((x) => has(x, i))
        .map((x) => ({ ...strip(x), sense: "as used here", band: "Y4", evidence: ev })),
      workedExamples: (last ? f.workedExamples : []).map((x) => ({
        ...strip(x),
        objectiveRefs: [{ type: "objective" as const, index: 0 }],
        evidence: ev,
      })),
      questions: f.questions
        .filter((x) => has(x, i))
        .map((q) => {
          const d = q as { demand?: string; forms?: string[] };
          return {
            ...strip(q),
            demand: d.demand ?? "recall",
            forms: d.forms ?? ["open-response"],
            distractors: (q.distractors ?? []).map((x) => ({ text: x.text })),
            evidence: ev,
          };
        }) as PackSection["facts"]["questions"],
    },
  };
}

function pack(): Pack {
  return {
    id: "romans.test",
    topic: "romans",
    subject: "History",
    yearGroup: "Year 4",
    arm: "hand",
    writtenAt: "2026-09-23T12:00:00.000Z",
    provenance: { writer: "none", writerPrompt: "hand" },
    sources: [
      {
        id: "s1",
        url,
        title: "Roman Britain",
        revision: "1",
        fetchedAt: "2026-09-23T12:00:00.000Z",
        licence: "CC-BY-SA-4.0",
        sentences: [{ id: "s1.1", heading: "Roman Britain", text: "The Romans came." }],
      },
    ],
    sections: romans.objectives.map((_, i) => sectionFor(i)),
  };
}

const select = (
  section: number | null,
  coverage: "full" | "partial" | "none",
  missingTypes: string[] = [],
) => JSON.stringify({ section, coverage, missingTypes, missingConcepts: [] });

/** A fill answer carrying exactly the types asked for (the fill schema is strict). */
function fillFor(types: readonly string[], target: number): string {
  const all: Record<string, unknown[]> = {
    keyIdeas: [{ statement: "filled idea", explanation: "e", example: "x" }],
    misconceptions: [{ belief: "b", correction: "c" }],
    vocabulary: [{ term: "filled term", definition: "d" }],
    workedExamples: [
      {
        problem: "p",
        steps: ["s"],
        answer: "a",
        objectiveRefs: [{ type: "objective", index: target }],
      },
    ],
    questions: [1, 2, 3].map((n) => ({
      stem: `filled ${n}?`,
      answer: "a",
      reasoning: "r",
      tier: "easy",
      use: "any",
      demand: "recall",
      forms: ["open-response"],
    })),
  };
  return JSON.stringify(Object.fromEntries(types.map((t) => [t, all[t]])));
}

const full = (section: number) => ({
  section,
  coverage: "full" as const,
  missingTypes: [],
  missingConcepts: [],
});

const audience = { subject: "History", yearGroup: "Year 4" };
const input = {
  topic: romans.topic,
  // A whole shape: the fill call renders the facts call's user turn, which reads all of it (v10).
  shape: lessonShapeOf(
    { objectiveVerb: "Explain why the Romans invaded Britain", priorConfidence: "New to it" },
    { yearGroup: "Year 4" },
  ),
  audience,
  objectives: romans.objectives,
};

describe("pack-arms hooks", () => {
  test("live has no hooks; grounded and packed give the objectives call the outcomes", () => {
    const selections: SelectRecord[] = [];
    const deps = recordingDeps(createFakeAi());
    expect(armHooks("live", undefined, audience, { deps, selections })).toBeUndefined();
    const grounded = armHooks("grounded", pack(), audience, { deps, selections });
    expect(grounded?.curriculum?.text).toBe(outcomesText(pack()));
    expect(grounded?.curriculum?.text).toContain(
      "1. Name two reasons why the Romans chose to invade Britain.",
    );
  });

  test("packed: full → pack, partial → pack + fill of the declared and empty types, none → call", async () => {
    const p = pack();
    // Objective 0 is declared full and its section holds every type: no fill. Objective 1 is
    // declared partial on worked examples: the fill covers those plus what sec2 holds none of.
    // Declared full, but sec1 holds no worked example (the fixture keeps it on the reach): the
    // structural gap is filled even when the model says full.
    const sec1Types = fillTypesFor(sectionFor(0), full(0));
    expect(sec1Types).toEqual(["workedExamples"]);
    const sec2Types = fillTypesFor(sectionFor(1), {
      ...full(1),
      coverage: "partial",
      missingTypes: ["workedExamples"],
    });
    expect(sec2Types).toContain("workedExamples");
    const ai = createFakeAi({
      script: [
        select(0, "full"),
        select(1, "partial", ["workedExamples"]),
        select(null, "none"),
        fillFor(sec1Types, 0),
        fillFor(sec2Types, 1),
      ],
    });
    const selections: SelectRecord[] = [];
    const hooks = armHooks("packed", p, audience, { deps: recordingDeps(ai), selections });
    const plans = await hooks?.factsFor?.(romans.objectives, input as never);
    expect(plans?.map((x) => x.mode)).toEqual(["pack", "pack", "call"]);
    const first = plans?.[0];
    const second = plans?.[1];
    if (first?.mode !== "pack" || second?.mode !== "pack") throw new Error("expected pack plans");
    expect(first.filled).toEqual(sec1Types);
    expect(first.output.keyIdeas).toEqual(
      sectionFor(0).facts.keyIdeas.map(({ evidence: _e, ...k }) => k),
    );
    expect(second.filled).toEqual(sec2Types);
    expect(second.output.workedExamples).toEqual([
      { problem: "p", steps: ["s"], answer: "a", objectiveRefs: [{ type: "objective", index: 1 }] },
    ]);
    expect(second.output.keyIdeas.length).toBeGreaterThan(0);
    expect(selections.map((s) => s.section)).toEqual(["sec1", "sec2", null]);
    const versions = ai.calls.map((c) => c.context?.promptVersion);
    expect(versions.filter((v) => v === packSelectPrompt.version).length).toBe(3);
    expect(versions.filter((v) => v === packFillPrompt.version).length).toBe(2);
  });

  test("grounded: a matched objective's call carries the section's facts as reference", async () => {
    const ai = createFakeAi({
      script: [select(2, "full"), select(null, "none"), select(0, "partial")],
    });
    const hooks = armHooks("grounded", pack(), audience, {
      deps: recordingDeps(ai),
      selections: [],
    });
    const plans = await hooks?.factsFor?.(romans.objectives, input as never);
    expect(plans?.map((x) => x.mode)).toEqual(["call", "call", "call"]);
    const first = plans?.[0];
    if (first?.mode !== "call") throw new Error("expected call");
    expect(first.reference).toBe(referenceText(sectionFor(2)));
    // Plain lines, no heading: the facts prompt's own reference line introduces them (v10).
    expect(first.reference).toMatch(/^- Key idea: /);
    // A fill's reference carries only the kept lists.
    expect(referenceText(sectionFor(2), ["vocabulary"])).toMatch(/^- Term: /);
    expect(referenceText(sectionFor(2), ["vocabulary"])).not.toContain("- Key idea:");
    expect(first.reference).not.toContain("Reference facts for");
    const second = plans?.[1];
    if (second?.mode !== "call") throw new Error("expected call");
    expect(second.reference).toBeUndefined();
  });

  test("fillTypesFor is the declared missing types plus every type the section holds none of", () => {
    const s = sectionFor(0); // no worked example on objective 0
    expect(
      fillTypesFor(s, {
        section: 0,
        coverage: "partial",
        missingTypes: ["questions"],
        missingConcepts: [],
      }),
    ).toEqual(["workedExamples", "questions"]);
    expect(
      fillTypesFor(s, {
        section: 0,
        coverage: "full",
        missingTypes: ["questions"],
        missingConcepts: [],
      }),
    ).toEqual(["workedExamples"]);
  });

  test("retarget points section-local objective refs at the lesson objective", () => {
    const out = retarget(
      {
        keyIdeas: [],
        misconceptions: [],
        vocabulary: [],
        workedExamples: [
          {
            problem: "p",
            steps: ["s"],
            answer: "a",
            objectiveRefs: [{ type: "objective", index: 0 }],
          },
        ],
        questions: [],
      },
      2,
    );
    expect(out.workedExamples[0]?.objectiveRefs).toEqual([{ type: "objective", index: 2 }]);
  });

  test("labPlan under the packed arm: outcomes reach the objectives call; no facts call on full coverage", async () => {
    const p = pack();
    const objectives = JSON.stringify({
      objectives: romans.objectives.map((o) => ({ text: o.text, curriculumAnchor: "unit" })),
    });
    const ai = createFakeAi({
      // Every section declared full; the types a section holds none of are still filled, in
      // objective order, so the script carries one fill answer per section that needs one.
      script: [
        objectives,
        select(0, "full"),
        select(1, "full"),
        select(2, "full"),
        ...[0, 1, 2]
          .map((i) => fillTypesFor(sectionFor(i), full(i)))
          .filter((types) => types.length > 0)
          .map((types, n) => fillFor(types, n)),
      ],
    });
    const deps = recordingDeps(ai);
    const lesson: Lesson = sampleBriefLesson({
      title: romans.topic,
      subject: romans.subject,
      yearGroup: romans.yearGroup,
      ageBand: "ks2",
      brief: { topic: romans.topic, durationMin: romans.durationMin, answers: romans.answers },
    } as Partial<Lesson>);
    const selections: SelectRecord[] = [];
    const arm = armHooks("packed", p, audience, { deps, selections });
    const state = await labPlan({ lesson }, deps, { verify: false, ...(arm ? { arm } : {}) });
    const versions = ai.calls.map((c) => c.context?.promptVersion);
    expect(versions[0]).toBe(planObjectivesPrompt.version);
    expect(ai.calls[0]?.promptText).toContain("Unit outcomes (one per section):");
    expect(versions).not.toContain(planFactsObjectivePrompt.version);
    const expectedSource = [0, 1, 2].map((i) => {
      const types = fillTypesFor(sectionFor(i), full(i));
      return types.length ? `pack+fill:${types.join(",")}` : "pack";
    });
    expect(state.labPlan.arm).toEqual({ name: "packed", factsSource: expectedSource });
    expect(expectedSource.at(-1)).toBe("pack");
    expect(state.labPlan.factsFailed).toEqual([]);
    expect(state.lesson.facts?.keyIdeas?.length).toBe(romans.facts.keyIdeas.length);
    expect(state.lesson.facts?.objectives.map((o) => o.text)).toEqual(
      romans.objectives.map((o) => o.text),
    );
  });
});
