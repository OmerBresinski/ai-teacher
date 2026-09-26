import { describe, expect, spyOn, test } from "bun:test";
import { type Budget, createBudget, type FakeCall } from "@tj/ai";
import { createFakeAi, type FakeScriptEntry } from "@tj/ai/testing";
import { checkLesson, type Lesson } from "@tj/domain/documents";
import { ledgerStageOf } from "../../eval/ledger";
import { MAX_OUTPUT_TOKENS } from "../call";
import romans from "../fixtures/objective-facts.y4-history-romans.json";
import { planFactsObjectiveOutputSchemaFor } from "../prompts/plan-facts-objective";
import { type PlanQuestionSetOutput, planQuestionSetPrompt } from "../prompts/plan-question-set";
import { planTeachObjectivePrompt } from "../prompts/plan-teach-objective";
import { lessonShapeOf } from "../shapes";
import { callLimitedBudget, FIXTURES, recordingDeps, sampleBriefLesson } from "../testing";
import { StageFailure } from "../types";
import {
  fitsExitLine,
  LAB_PLANNED_VERSION,
  LAB_WAVES_PLANNED_VERSION,
  LabPlanBlocked,
  labPlan,
  labPlanMarkdown,
  labRunStatus,
  labStatusLine,
  MAX_OUTPUT_TOKENS_OBJECTIVES,
  MISSING_MATERIAL_CHECK,
  questionSetProblem,
  runLabPipeline,
} from "./plan-pipeline";

/** A budget that admits everything and records the output cap each call reserved. */
function reserveRecordingBudget(): Budget & { reservedOutput: number[] } {
  const real = createBudget({ capUsd: 1000, capTokens: 100_000_000 });
  const reservedOutput: number[] = [];
  return {
    ...real,
    reservedOutput,
    reserve(modelId, estimate) {
      reservedOutput.push(estimate.outputTokens);
      return real.reserve(modelId, estimate);
    },
  };
}

/*
 * The lab plan path with every model call stubbed (no network): the objectives call, the
 * per-objective facts calls in parallel, the code-written outline, the checkpoint, Verify handed
 * on, and the production stages after it. Answers come from the Romans fixture
 * (`fixtures/objective-facts.y4-history-romans.json`), sliced back into the three per-objective
 * answers the merge takes, so the merged facts are ones the outline step is already measured on.
 */

const json = (v: unknown) => JSON.stringify(v);
const usage = { inputTokens: 1000, outputTokens: 400 };

function romansLesson(): Lesson {
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
function factsAnswerFor(i: number) {
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

test("the fixture slices pass the per-objective schema (the stubs answer in the real shape)", () => {
  const shape = lessonShapeOf(romans.answers, { yearGroup: romans.yearGroup });
  romans.objectives.forEach((_, target) => {
    const schema = planFactsObjectiveOutputSchemaFor({
      shape,
      objectives: romans.objectives,
      target,
    });
    const parsed = schema.safeParse(factsAnswerFor(target));
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });
});

/** A question set as the split call returns one: `count` questions, each on the taught key idea 0. */
function questionSetAnswer(
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
function labAi(
  options: {
    objectives?: unknown;
    /** The objectives call's retrieval set (v12); omitted: an answer without one, as v11 gave. */
    retrieval?: unknown;
    /** l6f: the objectives call's flow; omitted: an answer without one. */
    flow?: unknown;
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
  } = {},
) {
  const fallback: FakeScriptEntry = async (call) => {
    const version = call.context?.promptVersion ?? "";
    if (version.startsWith("plan-objectives"))
      return json({
        objectives: options.objectives ?? romans.objectives,
        ...(options.retrieval === undefined ? {} : { retrieval: options.retrieval }),
        ...(options.flow === undefined ? {} : { flow: options.flow }),
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

const versionsOf = (ai: ReturnType<typeof labAi>) =>
  ai.calls.map((c) => (c.context?.promptVersion ?? "").replace(/\.v\d+$/, ""));

describe("labPlan", () => {
  test("objectives, then every facts call at once, then the outline in code: two persists, one checkpoint, Verify started not awaited", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let arrived = 0;
    let release: () => void = () => {};
    const all = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ai = labAi({
      facts: async (_call, target) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (++arrived === romans.objectives.length) release();
        // Every call waits for the last to arrive: sequential calls would deadlock the barrier,
        // so the timeout below is the failure signal, not a wait.
        await Promise.race([all, new Promise((r) => setTimeout(r, 500))]);
        inFlight--;
        return json(factsAnswerFor(target));
      },
    });
    const deps = recordingDeps(ai);
    const state = await labPlan({ lesson: romansLesson() }, deps);

    expect(maxInFlight).toBe(3);
    // Verify's call is in flight, not yet recorded: the plan returned without awaiting it.
    expect(versionsOf(ai)).toEqual([
      "plan-objectives",
      "plan-facts-objective",
      "plan-facts-objective",
      "plan-facts-objective",
    ]);
    expect(deps.persisted).toHaveLength(2);
    expect(deps.persisted[0]?.lesson.slides.map((s) => s.kind)).toEqual(["title"]);
    expect(deps.persisted[0]?.lesson.generation).toBeUndefined();
    expect(deps.progress.map((p) => [p.percent, p.stage])).toEqual([
      [2, "plan"],
      [10, "plan"],
    ]);

    const lesson = state.lesson;
    expect(lesson.generation?.stage).toBe("planned");
    expect(lesson.generation?.promptVersions.planned).toBe(LAB_PLANNED_VERSION);
    expect(lesson.slides.map((s) => s.kind)).toEqual(["title", "objectives"]);
    expect(lesson.facts?.objectives.map((o) => o.text)).toEqual(
      romans.objectives.map((o) => o.text),
    );
    expect(lesson.facts?.outline).toHaveLength(10);
    expect(lesson.facts?.outline[0]?.kind).toBe("title");
    expect(lesson.facts?.outline[1]?.kind).toBe("objectives");
    expect(lesson.facts?.outline.at(-1)?.kind).toBe("exit-ticket");
    expect(lesson.facts?.keyIdeas).toHaveLength(romans.facts.keyIdeas.length);
    expect(lesson.facts?.questions).toHaveLength(romans.facts.questions.length);
    expect(lesson.facts?.workedExamples).toHaveLength(1);
    // Every item carries the objective whose call wrote it.
    expect(lesson.facts?.keyIdeas?.every((k) => k.objectiveRefs.length > 0)).toBe(true);
    expect(checkLesson(lesson).filter((f) => f.severity === "error")).toEqual([]);

    const report = state.labPlan;
    expect(report.objectives).toHaveLength(3);
    expect(report.objectiveIssues).toEqual([]);
    expect(report.factsFailed).toEqual([]);
    expect(report.slideCount).toBe(10);
    expect(report.coverage).toHaveLength(3);
    expect(report.coverage.every((c) => c.taught.length > 0)).toBe(true);
    expect(report.verify).toBe("started");
    expect(labPlanMarkdown(report)).toContain("objectives check: pass");
    // The plan alone has not executed the pipeline; it is complete when nothing is missing.
    expect(report.status.executed).toBe(false);
    expect(report.status.accepted).toBeNull();
    expect(report.status.complete).toBe(report.status.incomplete.length === 0);
    expect(labPlanMarkdown(report)).toContain(`status: ${labStatusLine(report.status)}`);

    // Verify is the promise Plan hands to Generate; its result is the facts, unchanged here.
    expect(state.pendingVerify).toBeDefined();
    const verified = await state.pendingVerify;
    expect(verified?.applied).toEqual([]);
    expect(verified?.facts).toEqual(lesson.facts as never);
    expect(versionsOf(ai).at(-1)).toBe("verify-facts");

    // The cost ledger buckets every call this path makes.
    const stages = new Set(ai.calls.map((c) => ledgerStageOf(c.context ?? {})));
    expect([...stages].sort()).toEqual(["facts", "objectives", "verify"]);
  });

  test("Verify reserves production's cap unless the lab passes a lower one for this checker", async () => {
    const byDefault = reserveRecordingBudget();
    const state = await labPlan(
      { lesson: romansLesson() },
      recordingDeps(labAi(), { budget: byDefault }),
    );
    await state.pendingVerify;
    expect(MAX_OUTPUT_TOKENS.verify).toBe(4000);
    expect(byDefault.reservedOutput.at(-1)).toBe(MAX_OUTPUT_TOKENS.verify);

    const lowered = reserveRecordingBudget();
    const lab = await labPlan(
      { lesson: romansLesson() },
      recordingDeps(labAi(), { budget: lowered }),
      {
        verifyMaxOutputTokens: 2000,
      },
    );
    await lab.pendingVerify;
    expect(lowered.reservedOutput.at(-1)).toBe(2000);
    // The plan's own calls keep their caps either way.
    expect(lowered.reservedOutput.slice(0, -1)).toEqual(byDefault.reservedOutput.slice(0, -1));
  });

  test("verify off: no verify-facts call anywhere, Generate is handed a settled empty result", async () => {
    const ai = labAi();
    const state = await labPlan({ lesson: romansLesson() }, recordingDeps(ai), { verify: false });
    expect(state.labPlan.verify).toBe("off");
    const result = await state.pendingVerify;
    expect(result?.findings).toEqual([]);
    expect(versionsOf(ai)).not.toContain("verify-facts");
  });

  test("a facts call that misses its schema twice leaves that objective without facts; the lesson is planned, incomplete, and says what is missing", async () => {
    const ai = labAi({
      facts: (_call, target) => (target === 1 ? "not json" : json(factsAnswerFor(target))),
    });
    const state = await labPlan({ lesson: romansLesson() }, recordingDeps(ai), { verify: false });
    expect(state.labPlan.factsFailed).toEqual([1]);
    expect(state.lesson.generation?.stage).toBe("planned");
    expect(state.lesson.facts?.objectives).toHaveLength(3);
    // Objective 2's material is missing; the outline says so instead of inventing it.
    expect(state.labPlan.gaps.length).toBeGreaterThan(0);
    expect(labPlanMarkdown(state.labPlan)).toContain("2/3 returned (failed: 2)");
    // Three statuses: not complete, and the reasons name the objective.
    expect(state.labPlan.status.complete).toBe(false);
    expect(state.labPlan.status.incomplete).toContain("objective 2: its facts call did not return");
    expect(state.labPlan.status.incomplete).toContain("objective 2: no slide teaches it");
    // The missing material is persisted on the lesson, not only reported.
    const missing = state.lesson.generation?.findings.filter(
      (f) => f.check === MISSING_MATERIAL_CHECK,
    );
    expect(missing?.map((f) => f.message)).toContain(
      "Objective 2 has no content or worked-example slide that teaches it.",
    );
  });

  test("every facts call failing fails the stage", async () => {
    const ai = labAi({ facts: () => "not json" });
    await expect(labPlan({ lesson: romansLesson() }, recordingDeps(ai))).rejects.toBeInstanceOf(
      StageFailure,
    );
  });

  test("the budget stopping two facts calls names both objectives in one finding", async () => {
    // Two calls admitted: the objectives call and whichever facts call reserves first; the other
    // two facts calls are refused and the one budget finding lists both.
    const ai = labAi();
    const deps = recordingDeps(ai, { budget: callLimitedBudget(2) });
    const state = await labPlan({ lesson: romansLesson() }, deps, { verify: false });
    expect(state.labPlan.factsFailed).toHaveLength(2);
    const budgetFindings = state.lesson.generation?.findings.filter((f) => f.check === "budget");
    expect(budgetFindings).toHaveLength(1);
    const listed = /objectives ([\d, ]+):/.exec(budgetFindings?.[0]?.message ?? "")?.[1] ?? "";
    expect(listed.split(", ").map(Number)).toEqual(state.labPlan.factsFailed.map((i) => i + 1));
    expect(state.labPlan.status.complete).toBe(false);
  });

  test("an objective a few words over the cap is kept and the facts calls run", async () => {
    const long =
      "Explain how Roman roads, forts and towns changed daily life for the people living in Britain back then";
    const ai = labAi({ objectives: [{ text: long }, { text: "Explain Boudica's revolt" }] });
    const state = await labPlan({ lesson: romansLesson() }, recordingDeps(ai), { verify: false });
    expect(long.split(" ").length).toBeGreaterThan(16);
    expect(versionsOf(ai).filter((v) => v === "plan-facts-objective").length).toBeGreaterThan(0);
    expect(state.labPlan.objectiveIssues ?? []).toEqual([]);
  });

  test("objectives that break the structural check block the run before any facts call", async () => {
    const ai = labAi({
      objectives: [{ text: "Understand the Romans" }, { text: "Explain Boudica's revolt" }],
    });
    const deps = recordingDeps(ai);
    let blocked: LabPlanBlocked | undefined;
    try {
      await labPlan({ lesson: romansLesson() }, deps, { verify: false });
    } catch (error) {
      if (error instanceof LabPlanBlocked) blocked = error;
      else throw error;
    }
    expect(blocked).toBeDefined();
    expect(blocked?.issues.join("\n")).toContain('"understand"');
    // The objectives call, and nothing after it: no facts call was paid for.
    expect(versionsOf(ai)).toEqual(["plan-objectives"]);
    expect(deps.persisted).toHaveLength(1);
    expect(blocked?.report.verify).toBe("blocked");
    expect(blocked?.report.status).toEqual({
      executed: false,
      complete: false,
      incomplete: blocked?.issues.map((i) => `objectives check: ${i}`) ?? [],
      accepted: null,
    });
    expect(labPlanMarkdown(blocked?.report as NonNullable<typeof blocked>["report"])).toContain(
      "objectives check: BLOCKED",
    );
    // The whole pipeline reports the block as a status, not a throw.
    const run = await runLabPipeline(
      { lesson: romansLesson() },
      recordingDeps(
        labAi({
          objectives: [{ text: "Understand the Romans" }, { text: "Explain Boudica's revolt" }],
        }),
      ),
    );
    expect(run.status.executed).toBe(false);
    expect(run.status.complete).toBe(false);
    expect(run.state.lesson.slides.map((s) => s.kind)).toEqual(["title"]);
  });
});

/** Year 3 knowledge under the Year 4 Romans lesson: answerable before it begins. */
const RETRIEVAL = [
  { question: "Which came first in Britain: the Iron Age or the Romans?", answer: "The Iron Age" },
  { question: "What is an invasion?", answer: "An army entering a country to take it over" },
  { question: "Name the sea between Britain and France.", answer: "The English Channel" },
];

describe("the retrieval starter (lab r2)", () => {
  test("the objectives cap is 1 600 and the objectives call reserves it", async () => {
    expect(MAX_OUTPUT_TOKENS_OBJECTIVES).toBe(1600);
    const budget = reserveRecordingBudget();
    await labPlan({ lesson: romansLesson() }, recordingDeps(labAi(), { budget }), {
      verify: false,
    });
    expect(budget.reservedOutput[0]).toBe(1600);
  });

  test("retrieval rides from the objectives call to the facts and the report; the starter takes no question of the lesson's", async () => {
    const state = await labPlan(
      { lesson: romansLesson() },
      recordingDeps(labAi({ retrieval: RETRIEVAL })),
      { verify: false },
    );
    const facts = state.lesson.facts;
    expect(facts?.retrieval).toEqual(RETRIEVAL);
    expect(state.labPlan.retrieval).toEqual(RETRIEVAL);
    expect(labPlanMarkdown(state.labPlan)).toContain(
      "starter retrieval (3): 1. Which came first in Britain",
    );
    const starter = facts?.outline.find((e) => e.kind === "starter");
    expect(starter).toBeDefined();
    expect(starter?.brief?.adds).toMatch(/^Retrieval: 3 quick questions on earlier lessons/);
    const questionIds = new Set(facts?.questions.map((q) => q.id));
    expect(starter?.factRefs.some((id) => questionIds.has(id))).toBe(false);
    // The lesson's questions keep to the checks and the exit quiz: the same count, none added.
    expect(facts?.questions).toHaveLength(romans.facts.questions.length);
    expect(facts?.questions.some((q) => RETRIEVAL.some((r) => r.question === q.stem))).toBe(false);
  });

  test("the pipeline prints the set on the starter, answers shown; no check, exit item or tested-not-taught finding comes of it", async () => {
    const ai = labAi({ retrieval: RETRIEVAL });
    const { state, status } = await runLabPipeline({ lesson: romansLesson() }, recordingDeps(ai));
    const lesson = state.lesson;
    expect(lesson.slides).toHaveLength(10);
    const at = lesson.slides.findIndex((s) => s.kind === "starter");
    expect(at).toBeGreaterThan(1);
    const text = (i: number) => JSON.stringify(lesson.slides[i]?.elements ?? []);
    for (const r of RETRIEVAL) {
      expect(text(at)).toContain(r.question);
      expect(text(at)).toContain(r.answer);
    }
    expect(lesson.slides[at]?.elements.find((e) => e.name === "Answers")?.revealStep).toBe(1);
    // Nowhere else: not a check, not the exit quiz.
    lesson.slides.forEach((_, i) => {
      if (i === at) return;
      for (const r of RETRIEVAL) expect(text(i)).not.toContain(r.question);
    });
    // Written in code: no generate-slide call was asked for the starter.
    expect(
      ai.calls.some(
        (c) =>
          (c.context?.promptVersion ?? "").startsWith("generate-slide") &&
          /kind "starter"/.test(c.promptText),
      ),
    ).toBe(false);
    const findings = checkLesson(lesson);
    expect(
      findings.filter(
        (f) => f.check === "tested-not-taught" && f.target.slideId === lesson.slides[at]?.id,
      ),
    ).toEqual([]);
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(status.executed).toBe(true);
  });

  test("without retrieval (v11 answers, old runs) the starter is round 1's and the facts carry no set", async () => {
    const state = await labPlan({ lesson: romansLesson() }, recordingDeps(labAi()), {
      verify: false,
    });
    expect(state.lesson.facts?.retrieval).toBeUndefined();
    expect(state.labPlan.retrieval).toBeUndefined();
    expect(labPlanMarkdown(state.labPlan)).not.toContain("starter retrieval");
    const starter = state.lesson.facts?.outline.find((e) => e.kind === "starter");
    expect(starter?.brief?.adds).not.toMatch(/earlier lessons/);
  });
});

describe("runLabPipeline", () => {
  test("fromFacts: no objectives, facts or verify call; the saved facts are outlined in code and every stage after Plan runs on them", async () => {
    const ai = labAi();
    const deps = recordingDeps(ai);
    const { state, report, status } = await runLabPipeline({ lesson: romansLesson() }, deps, {
      verify: false,
      fromFacts: {
        source: "saved-run",
        objectives: romans.objectives,
        facts: romans.facts as never,
      },
    });
    const versions = versionsOf(ai);
    expect(versions.filter((v) => v.startsWith("plan-") || v === "verify-facts")).toEqual([]);
    expect(versions.filter((v) => v === "generate-slide").length).toBeGreaterThanOrEqual(8);
    expect(versions).toContain("evaluate");
    const stages = new Set(ai.calls.map((c) => ledgerStageOf(c.context ?? {})));
    expect(stages.has("objectives") || stages.has("facts")).toBe(false);
    expect(report.fromFacts).toBe("saved-run");
    expect(report.verify).toBe("off");
    expect(report.objectives.map((o) => o.text)).toEqual(romans.objectives.map((o) => o.text));
    expect(labPlanMarkdown(report)).toContain("from facts: saved-run");
    // The facts are the saved ones, unchanged by the path (ids assigned in order).
    expect(state.lesson.facts?.keyIdeas?.map((k) => k.statement)).toEqual(
      romans.facts.keyIdeas.map((k) => k.statement),
    );
    expect(state.lesson.generation?.stage).toBe("repaired");
    expect(state.lesson.slides).toHaveLength(state.lesson.facts?.outline.length ?? -1);
    expect(status.executed).toBe(true);
  });

  test("fromFacts refuses an arm (an arm only changes the facts)", async () => {
    const deps = recordingDeps(labAi());
    await expect(
      labPlan({ lesson: romansLesson() }, deps, {
        arm: { name: "live" },
        fromFacts: { source: "x", objectives: romans.objectives, facts: romans.facts as never },
      }),
    ).rejects.toThrow("do not combine");
  });

  test("Generate, Illustrate, Evaluate and Repair run on the lab plan; Verify's findings reach the lesson; the ledger sees every stage; the statuses are set", async () => {
    const ai = labAi({
      verify: {
        corrections: [
          {
            factId: "v1",
            field: "definition",
            value: "A corrected definition.",
            reason: "ambiguous",
          },
        ],
      },
    });
    const deps = recordingDeps(ai);
    const { state, report, status } = await runLabPipeline({ lesson: romansLesson() }, deps);
    expect(report.verify).toBe("started");
    expect(state.lesson.generation?.stage).toBe("repaired");
    expect(state.lesson.slides).toHaveLength(10);
    expect(state.lesson.facts?.vocabulary[0]?.definition).toBe("A corrected definition.");
    expect(state.lesson.generation?.findings.filter((f) => f.check === "fact-verify")).toHaveLength(
      1,
    );
    expect(state.lesson.generation?.promptVersions.planned?.startsWith(LAB_PLANNED_VERSION)).toBe(
      true,
    );
    expect(checkLesson(state.lesson).filter((f) => f.severity === "error")).toEqual([]);
    // The lab's outline assigns callouts, so here (and only here) a slide written without its
    // assigned box is an editorial miss the stubbed writer never supplies.
    expect(report.callouts).toBeGreaterThan(0);
    expect(
      state.lesson.generation?.findings.some(
        (f) => f.check === "spec-rule" && /callout/i.test(f.message),
      ),
    ).toBe(true);
    // Executed: the run reached the end. Complete: read off the outline and the documents, and
    // here nothing is missing. Accepted: the judge's.
    expect(status.executed).toBe(true);
    expect(status).toEqual(report.status);
    expect(status.accepted).toBeNull();
    expect(status.incomplete).toEqual([]);
    expect(status.complete).toBe(true);

    const versions = versionsOf(ai);
    // Eight slides, plus the one Generate regenerated because it was written from the fact
    // Verify corrected before the patch landed (TEACH-233).
    expect(versions.filter((v) => v === "generate-slide").length).toBeGreaterThanOrEqual(8);
    expect(versions.filter((v) => v === "verify-facts")).toHaveLength(1);
    expect(versions.filter((v) => v === "evaluate")).toHaveLength(1);
    // Verify ran alongside the slides: started before the first slide call was made.
    expect(versions.indexOf("verify-facts")).toBeLessThan(versions.indexOf("generate-slide"));
    // Repair runs only when Evaluate or the checks left an error finding; the rest always run.
    const stages = new Set(ai.calls.map((c) => ledgerStageOf(c.context ?? {})));
    for (const stage of ["objectives", "facts", "verify", "generate", "evaluate"] as const)
      expect(stages).toContain(stage);
    expect(stages.has("other")).toBe(false);
  });

  test("the budget stopping Generate mid-way: executed, not complete, the stop and the missing slides among the reasons", async () => {
    // Four calls plan the lesson (objectives + three facts, Verify off); two more write slides;
    // the rest are refused, so Generate stops and keeps what was written.
    const ai = labAi();
    const deps = recordingDeps(ai, { budget: callLimitedBudget(6) });
    const { state, report, status } = await runLabPipeline({ lesson: romansLesson() }, deps, {
      verify: false,
    });
    // The plan itself was complete: nothing in the plan's reasons.
    expect(report.factsFailed).toEqual([]);
    expect(status.executed).toBe(true);
    expect(status.complete).toBe(false);
    expect(status).toEqual(report.status);
    const outlined = state.lesson.facts?.outline.length ?? 0;
    expect(state.lesson.slides.length).toBeLessThan(outlined);
    expect(
      status.incomplete.some((line) => /Generation stopped at slide \d+ of \d+/.test(line)),
    ).toBe(true);
    expect(status.incomplete).toContain(
      `${state.lesson.slides.length} of the ${outlined} outlined slides written`,
    );
    // Every reason is on the lesson too: the budget finding is persisted, not only reported.
    expect(state.lesson.generation?.findings.some((f) => f.check === "budget")).toBe(true);
  });

  test("a stage that throws: not executed, the failure first among the reasons, the state as it stood before that stage", async () => {
    // Every slide answer misses the schema twice: Generate fails; nothing after it runs.
    const failing = labAi({ slide: () => "not json" });
    const deps = recordingDeps(failing);
    const { state, status } = await runLabPipeline({ lesson: romansLesson() }, deps, {
      verify: false,
    });
    expect(status.executed).toBe(false);
    expect(status.complete).toBe(false);
    expect(status.incomplete[0]).toMatch(/^generate failed: /);
    expect(state.lesson.generation?.stage).toBe("planned");
    expect(versionsOf(failing)).not.toContain("evaluate");
  });

  test("labRunStatus reads the documents: a budget finding, an error-severity check finding or a short slide deck each make the run incomplete", () => {
    const plan = { executed: false, complete: true, incomplete: [], accepted: null };
    const lesson = romansLesson();
    expect(labRunStatus(plan, lesson)).toEqual({
      executed: true,
      complete: true,
      incomplete: [],
      accepted: null,
    });
    const failed = labRunStatus(plan, lesson, undefined, "evaluate failed: StageFailure: x");
    expect(failed.executed).toBe(false);
    expect(failed.complete).toBe(false);
    expect(failed.incomplete[0]).toBe("evaluate failed: StageFailure: x");
    // The plan's reasons stay first after a failure line, and are never repeated.
    const planned = { ...plan, complete: false, incomplete: ["objective 2: no slide teaches it"] };
    expect(labRunStatus(planned, lesson).incomplete).toEqual(["objective 2: no slide teaches it"]);
  });
});

describe("labPlan --waves (lab pw)", () => {
  const countOf = (ai: ReturnType<typeof labAi>, name: string) =>
    versionsOf(ai).filter((v) => v === name).length;
  /** The objectives call's retrieval set (v12+ always writes one): the starter prints it, so the
   * demand is the pinned `question-demand.test.ts` one — slide [4, 4, 0], exit [2, 2, 2]. */
  const retrieval = [
    { question: "Who invaded Britain in AD 43?", answer: "The Romans" },
    { question: "What is an empire?", answer: "Lands ruled by one state" },
    { question: "Name one Roman road.", answer: "Watling Street" },
  ];

  test("teach per objective, then that objective's question sets the moment its teach returns; the merge and outline read the result unchanged", async () => {
    // Objective 1's teach call is held until another objective's question set has been asked
    // for: the sets do not wait for the slowest teach.
    let firstSetAsked: () => void = () => {};
    const aSetWasAsked = new Promise<void>((resolve) => {
      firstSetAsked = resolve;
    });
    let setsBeforeTeach1Returned = 0;
    const ai = labAi({
      retrieval,
      teach: async (_call, target) => {
        if (target === 0) {
          await Promise.race([aSetWasAsked, new Promise((r) => setTimeout(r, 500))]);
          setsBeforeTeach1Returned = countOf(ai, "plan-question-set");
        }
        const { questions: _q, ...taught } = factsAnswerFor(target);
        return json(taught);
      },
      questionSet: async (_call, set) => {
        firstSetAsked();
        return json(questionSetAnswer(set));
      },
    });
    const deps = recordingDeps(ai);
    const state = await labPlan({ lesson: romansLesson() }, deps, { waves: true });

    expect(countOf(ai, "plan-objectives")).toBe(1);
    expect(countOf(ai, "plan-facts-objective")).toBe(0);
    expect(countOf(ai, "plan-teach-objective")).toBe(3);
    // Three objectives at ten slides: slide sets for the first two, an exit set for each.
    expect(countOf(ai, "plan-question-set")).toBe(5);
    expect(setsBeforeTeach1Returned).toBeGreaterThanOrEqual(1);

    const report = state.labPlan;
    expect(report.waves?.demand).toEqual([
      { slide: 2, exit: 1 },
      { slide: 2, exit: 1 },
      { slide: 0, exit: 1 },
    ]);
    expect(report.waves?.counts).toEqual([
      { slide: 3, exit: 1 },
      { slide: 3, exit: 1 },
      { slide: 0, exit: 1 },
    ]);
    expect(report.waves?.regenerated).toEqual([]);
    expect(report.waves?.setsFailed).toEqual([]);
    expect(report.factsFailed).toEqual([]);

    const lesson = state.lesson;
    expect(lesson.generation?.promptVersions.planned).toBe(LAB_WAVES_PLANNED_VERSION);
    expect(lesson.facts?.questions).toHaveLength(3 + 1 + 3 + 1 + 1);
    expect(lesson.facts?.keyIdeas).toHaveLength(romans.facts.keyIdeas.length);
    // Every question carries its objective and, via the merge, the taught key idea it named.
    expect(
      lesson.facts?.questions.every(
        (q) => (q.objectiveRefs ?? []).length === 1 && q.keyIdeaRefs?.length === 1,
      ),
    ).toBe(true);
    expect(lesson.facts?.outline).toHaveLength(10);
    expect(lesson.facts?.outline.at(-1)?.kind).toBe("exit-ticket");
    expect(checkLesson(lesson).filter((f) => f.severity === "error")).toEqual([]);
    expect(report.status.complete).toBe(true);
    expect(labPlanMarkdown(report)).toContain("- waves: demand o1 slide 2/exit 1");
  });

  test("audit A4: an objective's exit set is written after its slide set and told the slide stems", async () => {
    const prompts: { use: string; target: number; text: string }[] = [];
    const ai = labAi({
      retrieval,
      questionSet: (call, set) => {
        prompts.push({ use: set.use, target: set.target, text: call.promptText });
        return json(questionSetAnswer(set));
      },
    });
    await labPlan({ lesson: romansLesson() }, recordingDeps(ai), { waves: true });
    const o1 = prompts.filter((p) => p.target === 0);
    expect(o1.map((p) => p.use)).toEqual(["slide", "exit"]);
    expect(o1[0]?.text).not.toContain("Already asked of this objective");
    expect(o1[1]?.text).toContain("Already asked of this objective");
    expect(o1[1]?.text).toContain("slide question 1 on objective 1: which is right?");
    // An objective with no slide set: its exit set has nothing to avoid.
    const o3 = prompts.filter((p) => p.target === 2);
    expect(o3.map((p) => p.use)).toEqual(["exit"]);
    expect(o3[0]?.text).not.toContain("Already asked of this objective");
  });

  test("audit A7: teach and every question set are given the starter's retrieval questions", async () => {
    const teach = spyOn(planTeachObjectivePrompt, "user");
    const sets = spyOn(planQuestionSetPrompt, "user");
    try {
      const ai = labAi({ retrieval, questionSet: (_call, set) => json(questionSetAnswer(set)) });
      await labPlan({ lesson: romansLesson() }, recordingDeps(ai), { waves: true });
      const starter = retrieval.map(({ question, answer }) => ({ question, answer }));
      const given = [...teach.mock.calls, ...sets.mock.calls].map(
        ([i]) => (i as { retrieval?: unknown }).retrieval,
      );
      expect(given).toHaveLength(3 + 5);
      expect(given.every((r) => JSON.stringify(r) === JSON.stringify(starter))).toBe(true);
      // Contract C1: the prompts render them, once, as the labelled starter block.
      const rendered = [...teach.mock.results, ...sets.mock.results].map((r) => String(r.value));
      const block =
        "Starter (earlier learning, not this lesson):\n  - Who invaded Britain in AD 43? — The Romans";
      expect(rendered.every((text) => text.split(block).length === 2)).toBe(true);
    } finally {
      teach.mockRestore();
      sets.mockRestore();
    }
  });

  test("a set the schema refuses twice (short by more than one; a key idea not supplied) is asked for once more", async () => {
    const asked: string[] = [];
    const ai = labAi({
      retrieval,
      questionSet: (_call, set) => {
        const key = `o${set.target + 1}/${set.use}`;
        asked.push(key);
        const nth = asked.filter((k) => k === key).length;
        // o1/slide: two of five on both of the first call's attempts (strict, then soft, which
        // admits `count − 1` at least); whole on the regeneration.
        if (key === "o1/slide" && nth <= 2)
          return json(questionSetAnswer({ ...set, count: set.count - 3 }));
        // o2/exit: a key idea the teach call did not supply, both attempts; then good.
        if (key === "o2/exit" && nth <= 2) return json(questionSetAnswer(set, 7));
        return json(questionSetAnswer(set));
      },
    });
    const state = await labPlan({ lesson: romansLesson() }, recordingDeps(ai), { waves: true });
    // Five sets; o1/slide and o2/exit cost two refused attempts and one regeneration each.
    const perKey = Object.fromEntries(
      [...new Set(asked)].sort().map((k) => [k, asked.filter((x) => x === k).length]),
    );
    expect(perKey).toEqual({
      "o1/exit": 1,
      "o1/slide": 3,
      "o2/exit": 3,
      "o2/slide": 1,
      "o3/exit": 1,
    });
    expect(state.labPlan.waves?.regenerated.map((r) => r.split(":")[0]).sort()).toEqual([
      "o1/slide",
      "o2/exit",
    ]);
    expect(state.labPlan.waves?.setsFailed).toEqual([]);
    expect(state.lesson.facts?.questions).toHaveLength(3 + 1 + 3 + 1 + 1);
  });

  test("questionSetProblem: the code check behind the schema — an empty keyIdeaRefs list, or a short set the soft schema let through", () => {
    const good = questionSetAnswer({ target: 0, use: "slide", count: 3 }) as PlanQuestionSetOutput;
    expect(questionSetProblem(good, 3, 2)).toBeUndefined();
    expect(questionSetProblem(good, 4, 2)).toBeUndefined();
    expect(questionSetProblem(good, 5, 2)).toBe("3 questions for 5 asked");
    const orphan = {
      questions: good.questions.map((q, i) => (i === 1 ? { ...q, keyIdeaRefs: [] } : q)),
    } as PlanQuestionSetOutput;
    expect(questionSetProblem(orphan, 3, 2)).toBe("question 2 names no supplied key idea");
    // pw prompts-2: an exit question the exit quiz cannot print as a line, and a set that repeats itself.
    const open = (stem: string) => ({
      ...good.questions[0],
      stem,
      forms: ["open-response"],
      distractors: [],
    });
    const exitSet = (qs: unknown[]) => ({ questions: qs }) as PlanQuestionSetOutput;
    expect(questionSetProblem(exitSet([open("What is a forum?")]), 1, 2, "exit")).toBeUndefined();
    expect(
      questionSetProblem(exitSet([open(`What is a forum? ${"x".repeat(160)}`)]), 1, 2, "exit"),
    ).toBe("exit question 1 does not fit one line of the exit quiz");
    // A slide set is not held to the line.
    expect(
      questionSetProblem(exitSet([open(`What is a forum? ${"x".repeat(160)}`)]), 1, 2),
    ).toBeUndefined();
    const mc = (text: string) => ({
      ...good.questions[0],
      stem: "Which road ran from Dover?",
      answer: "Watling Street",
      forms: ["multiple-choice", "open-response"],
      distractors: [{ text }, { text: "Fosse Way" }, { text: "Ermine Street" }],
    });
    expect(fitsExitLine(mc("Dere Street") as never)).toBe(true);
    expect(fitsExitLine(mc("Watling Street") as never)).toBe(false); // an option repeats the answer
    expect(fitsExitLine(mc("x".repeat(200)) as never)).toBe(false); // over the multiple-choice line
    const repeat = exitSet([
      {
        ...open("Why did the government move children from cities such as London in 1939?"),
        answer: "To protect them from bombing",
      },
      {
        ...open(
          "Why did the government move children from a British city to the countryside in 1939?",
        ),
        answer: "To protect them from possible bombing",
      },
    ]);
    expect(questionSetProblem(repeat, 2, 2, "exit")).toBe("questions 1 and 2 ask the same thing");
  });

  test("a teach call that fails leaves its objective without facts; a set that fails leaves its questions out; the run goes on", async () => {
    const ai = labAi({
      retrieval,
      teach: (_call, target) => {
        if (target === 2) throw new Error("provider down");
        const { questions: _q, ...taught } = factsAnswerFor(target);
        return json(taught);
      },
      questionSet: (_call, set) => {
        if (set.target === 1 && set.use === "exit") throw new Error("provider down");
        return json(questionSetAnswer(set));
      },
    });
    const state = await labPlan({ lesson: romansLesson() }, recordingDeps(ai), { waves: true });
    expect(state.labPlan.factsFailed).toEqual([2]);
    expect(state.labPlan.waves?.setsFailed).toEqual(["o2/exit"]);
    expect(state.lesson.facts?.questions).toHaveLength(3 + 1 + 3);
    expect(state.labPlan.status.complete).toBe(false);
    expect(state.labPlan.status.incomplete).toContain("objective 3: its facts call did not return");
  });

  test("the whole pipeline under --waves: generate, evaluate and repair run on the waves' facts", async () => {
    const ai = labAi({ retrieval });
    const deps = recordingDeps(ai);
    const { status, state } = await runLabPipeline({ lesson: romansLesson() }, deps, {
      waves: true,
      verify: false,
    });
    expect(status.executed).toBe(true);
    expect(state.lesson.generation?.stage).toBe("repaired");
    expect(state.lesson.slides).toHaveLength(10);
    expect(countOf(ai, "plan-facts-objective")).toBe(0);
    expect(countOf(ai, "verify-facts")).toBe(0);
  });
});

describe("labPlan ignoreFlow (lab l6g, --no-flow)", () => {
  const retrieval = [
    { question: "Who invaded Britain in AD 43?", answer: "The Romans" },
    { question: "What is an empire?", answer: "Lands ruled by one state" },
    { question: "Name one Roman road.", answer: "Watling Street" },
  ];
  const flow = {
    opener: "hook",
    workedExample: false,
    commonMistake: true,
    vocabulary: true,
  } as const;
  const outlineOf = async (ai: ReturnType<typeof labAi>, ignoreFlow?: boolean) => {
    const state = await labPlan({ lesson: romansLesson() }, recordingDeps(ai), {
      verify: false,
      waves: true,
      ...(ignoreFlow ? { ignoreFlow } : {}),
    });
    return { outline: state.lesson.facts?.outline, report: state.labPlan };
  };

  test("the model's flow is dropped: the outline equals round B's (no flow) and the report carries none", async () => {
    const b = await outlineOf(labAi({ retrieval }));
    const withFlow = await outlineOf(labAi({ retrieval, flow }));
    const ignored = await outlineOf(labAi({ retrieval, flow }), true);

    expect(b.outline?.length).toBeGreaterThan(0);
    expect(withFlow.report.flow).toEqual(flow);
    expect(withFlow.outline).not.toEqual(b.outline);
    expect(ignored.report.flow).toBeUndefined();
    expect(ignored.outline).toEqual(b.outline);
  });
});
