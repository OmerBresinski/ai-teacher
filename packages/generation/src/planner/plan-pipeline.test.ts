import { describe, expect, spyOn, test } from "bun:test";
import { type Budget, createBudget } from "@tj/ai";
import { checkLesson } from "@tj/domain/documents";
import romans from "../fixtures/objective-facts.y4-history-romans.json";
import { planFactsObjectiveOutputSchemaFor } from "../prompts/plan-facts-objective";
import { type PlanQuestionSetOutput, planQuestionSetPrompt } from "../prompts/plan-question-set";
import { planTeachObjectivePrompt } from "../prompts/plan-teach-objective";
import { lessonShapeOf } from "../shapes";
import { OBJECTIVES_FIRST_VERSION } from "../stages/objectives-first";
import { callLimitedBudget, recordingDeps } from "../testing";
import {
  fitsExitLine,
  MAX_OUTPUT_TOKENS_OBJECTIVES,
  PLANNED_VERSION,
  PlanBlocked,
  planFromObjectives,
  planReportMarkdown,
  questionSetProblem,
  runPlannedLessonPipeline,
  runStatus,
} from "./plan-pipeline";
import { factsAnswerFor, labAi, questionSetAnswer, romansLesson, versionsOf } from "./testing";

const json = (v: unknown) => JSON.stringify(v);

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

describe("planFromObjectives", () => {
  test("verify off: no verify-facts call anywhere, Generate is handed a settled empty result", async () => {
    const ai = labAi();
    const state = await planFromObjectives({ lesson: romansLesson() }, recordingDeps(ai), {
      verify: false,
    });
    expect(state.planReport.verify).toBe("off");
    const result = await state.pendingVerify;
    expect(result?.findings).toEqual([]);
    expect(versionsOf(ai)).not.toContain("verify-facts");
  });

  test("objectives that break the structural check twice block the run before any facts call", async () => {
    const ai = labAi({
      objectives: [{ text: "Understand the Romans" }, { text: "Explain Boudica's revolt" }],
    });
    const deps = recordingDeps(ai);
    let blocked: PlanBlocked | undefined;
    try {
      await planFromObjectives({ lesson: romansLesson() }, deps, { verify: false });
    } catch (error) {
      if (error instanceof PlanBlocked) blocked = error;
      else throw error;
    }
    expect(blocked).toBeDefined();
    expect(blocked?.issues.join("\n")).toContain('"understand"');
    // The objectives call, asked once more, and nothing after it: no facts call was paid for,
    // and nothing was persisted.
    expect(versionsOf(ai)).toEqual(["plan-objectives", "plan-objectives"]);
    expect(deps.persisted).toHaveLength(0);
    expect(blocked?.reason).toBe("objectives-check");
    expect(blocked?.report.verify).toBe("blocked");
    expect(blocked?.report.status).toEqual({
      executed: false,
      complete: false,
      incomplete: blocked?.issues.map((i) => `objectives check: ${i}`) ?? [],
      accepted: null,
    });
    expect(planReportMarkdown(blocked?.report as NonNullable<typeof blocked>["report"])).toContain(
      "objectives check: BLOCKED",
    );
    // The whole pipeline reports the block as a status, not a throw.
    const run = await runPlannedLessonPipeline(
      { lesson: romansLesson() },
      recordingDeps(
        labAi({
          objectives: [{ text: "Understand the Romans" }, { text: "Explain Boudica's revolt" }],
        }),
      ),
    );
    expect(run.status.executed).toBe(false);
    expect(run.status.complete).toBe(false);
    expect(run.state.lesson.slides).toEqual(romansLesson().slides);
  });

  test("a set that fails the check once is asked for again; the second set goes on to the facts", async () => {
    const ai = labAi({
      objectivesAt: (n) =>
        n === 1
          ? [{ text: "Understand the Romans" }, { text: "Explain Boudica's revolt" }]
          : romans.objectives,
    });
    const deps = recordingDeps(ai);
    const state = await planFromObjectives({ lesson: romansLesson() }, deps, { verify: false });
    expect(versionsOf(ai).filter((v) => v === "plan-objectives")).toHaveLength(2);
    expect(versionsOf(ai)).toContain("plan-teach-objective");
    expect(state.planReport.objectiveIssues).toEqual([]);
    expect(state.lesson.facts?.objectives.map((o) => o.text)).toEqual(
      romans.objectives.map((o) => o.text),
    );
  });

  test("two persists: title and objectives together first, then the outlined checkpoint", async () => {
    const deps = recordingDeps(labAi());
    await planFromObjectives({ lesson: romansLesson() }, deps, { verify: false });
    expect(deps.persisted).toHaveLength(2);
    const [first, second] = deps.persisted.map((p) => p.lesson);
    expect(first?.slides.map((s) => s.kind)).toEqual(["title", "objectives"]);
    expect(first?.facts?.outline).toEqual([]);
    expect(first?.generation?.promptVersions.planned).toBe(OBJECTIVES_FIRST_VERSION);
    expect(second?.facts?.outline.length).toBeGreaterThan(2);
    expect(second?.generation?.promptVersions.planned).toBe(PLANNED_VERSION);
    // The objectives slide keeps its id across the two persists.
    expect(second?.slides[1]?.id).toBe(first?.slides[1]?.id as string);
    expect(
      deps.progress.map((p) => [p.percent, p.message, p.documentUpdatedAt !== undefined]),
    ).toEqual([
      [2, "Starting", false],
      [10, "Planned", true],
      [10, "Planning the slides", false],
      [10, "Planned", true],
    ]);
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
    await planFromObjectives({ lesson: romansLesson() }, recordingDeps(labAi(), { budget }), {
      verify: false,
    });
    expect(budget.reservedOutput[0]).toBe(1600);
  });

  test("retrieval rides from the objectives call to the facts and the report; the starter takes no question of the lesson's", async () => {
    const state = await planFromObjectives(
      { lesson: romansLesson() },
      recordingDeps(labAi({ retrieval: RETRIEVAL })),
      { verify: false },
    );
    const facts = state.lesson.facts;
    expect(facts?.retrieval).toEqual(RETRIEVAL);
    expect(state.planReport.retrieval).toEqual(RETRIEVAL);
    expect(planReportMarkdown(state.planReport)).toContain(
      "starter retrieval (3): 1. Which came first in Britain",
    );
    const starter = facts?.outline.find((e) => e.kind === "starter");
    expect(starter).toBeDefined();
    expect(starter?.brief?.adds).toMatch(/^Retrieval: 3 quick questions on earlier lessons/);
    const questionIds = new Set(facts?.questions.map((q) => q.id));
    expect(starter?.factRefs.some((id) => questionIds.has(id))).toBe(false);
    expect(facts?.questions.some((q) => RETRIEVAL.some((r) => r.question === q.stem))).toBe(false);
  });

  test("the pipeline prints the set on the starter, answers shown; no check, exit item or tested-not-taught finding comes of it", async () => {
    const ai = labAi({ retrieval: RETRIEVAL });
    const { state, status } = await runPlannedLessonPipeline(
      { lesson: romansLesson() },
      recordingDeps(ai),
    );
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
    const state = await planFromObjectives({ lesson: romansLesson() }, recordingDeps(labAi()), {
      verify: false,
    });
    expect(state.lesson.facts?.retrieval).toBeUndefined();
    expect(state.planReport.retrieval).toBeUndefined();
    expect(planReportMarkdown(state.planReport)).not.toContain("starter retrieval");
    const starter = state.lesson.facts?.outline.find((e) => e.kind === "starter");
    expect(starter?.brief?.adds).not.toMatch(/earlier lessons/);
  });
});

describe("runPlannedLessonPipeline", () => {
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
    const { state, report, status } = await runPlannedLessonPipeline(
      { lesson: romansLesson() },
      deps,
    );
    expect(report.verify).toBe("started");
    expect(state.lesson.generation?.stage).toBe("repaired");
    expect(state.lesson.slides).toHaveLength(10);
    expect(state.lesson.facts?.vocabulary[0]?.definition).toBe("A corrected definition.");
    expect(state.lesson.generation?.findings.filter((f) => f.check === "fact-verify")).toHaveLength(
      1,
    );
    expect(state.lesson.generation?.promptVersions.planned?.startsWith(PLANNED_VERSION)).toBe(true);
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
  });

  test("the budget stopping Generate mid-way: executed, not complete, the stop and the missing slides among the reasons", async () => {
    // The plan's calls (objectives, the teach calls and the question sets, Verify off) are
    // counted on a probe run; two more write slides; the rest are refused, so Generate stops and
    // keeps what was written.
    const probe = labAi();
    await planFromObjectives({ lesson: romansLesson() }, recordingDeps(probe), { verify: false });
    const ai = labAi();
    const deps = recordingDeps(ai, { budget: callLimitedBudget(probe.calls.length + 2) });
    const { state, report, status } = await runPlannedLessonPipeline(
      { lesson: romansLesson() },
      deps,
      {
        verify: false,
      },
    );
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
    const { state, status } = await runPlannedLessonPipeline({ lesson: romansLesson() }, deps, {
      verify: false,
    });
    expect(status.executed).toBe(false);
    expect(status.complete).toBe(false);
    expect(status.incomplete[0]).toMatch(/^generate failed: /);
    expect(state.lesson.generation?.stage).toBe("planned");
    expect(versionsOf(failing)).not.toContain("evaluate");
  });

  test("runStatus reads the documents: a budget finding, an error-severity check finding or a short slide deck each make the run incomplete", () => {
    const plan = { executed: false, complete: true, incomplete: [], accepted: null };
    const lesson = romansLesson();
    expect(runStatus(plan, lesson)).toEqual({
      executed: true,
      complete: true,
      incomplete: [],
      accepted: null,
    });
    const failed = runStatus(plan, lesson, undefined, "evaluate failed: StageFailure: x");
    expect(failed.executed).toBe(false);
    expect(failed.complete).toBe(false);
    expect(failed.incomplete[0]).toBe("evaluate failed: StageFailure: x");
    // The plan's reasons stay first after a failure line, and are never repeated.
    const planned = { ...plan, complete: false, incomplete: ["objective 2: no slide teaches it"] };
    expect(runStatus(planned, lesson).incomplete).toEqual(["objective 2: no slide teaches it"]);
  });
});

describe("planFromObjectives: the waves (lab pw)", () => {
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
    const state = await planFromObjectives({ lesson: romansLesson() }, deps);

    expect(countOf(ai, "plan-objectives")).toBe(1);
    expect(countOf(ai, "plan-facts-objective")).toBe(0);
    expect(countOf(ai, "plan-teach-objective")).toBe(3);
    // Three objectives at ten slides: slide sets for the first two, an exit set for each.
    expect(countOf(ai, "plan-question-set")).toBe(5);
    expect(setsBeforeTeach1Returned).toBeGreaterThanOrEqual(1);

    const report = state.planReport;
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
    expect(lesson.generation?.promptVersions.planned).toBe(PLANNED_VERSION);
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
    expect(planReportMarkdown(report)).toContain("- waves: demand o1 slide 2/exit 1");
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
    await planFromObjectives({ lesson: romansLesson() }, recordingDeps(ai));
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
      await planFromObjectives({ lesson: romansLesson() }, recordingDeps(ai));
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
    const state = await planFromObjectives({ lesson: romansLesson() }, recordingDeps(ai));
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
    expect(state.planReport.waves?.regenerated.map((r) => r.split(":")[0]).sort()).toEqual([
      "o1/slide",
      "o2/exit",
    ]);
    expect(state.planReport.waves?.setsFailed).toEqual([]);
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
    // Rivers, 25 Sep: a stem that asks pupils to choose from options it does not list.
    const rivers = open("Which of the following new housing plans would most reduce flood risk?");
    expect(questionSetProblem(exitSet([open("What is a forum?"), rivers]), 2, 2)).toBe(
      "question 2 asks pupils to choose from options it does not list",
    );
    expect(
      questionSetProblem(
        exitSet([{ ...rivers, distractors: mc("Dere Street").distractors }]),
        1,
        2,
      ),
    ).toBeUndefined();
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
    const state = await planFromObjectives({ lesson: romansLesson() }, recordingDeps(ai));
    expect(state.planReport.factsFailed).toEqual([2]);
    expect(state.planReport.waves?.setsFailed).toEqual(["o2/exit"]);
    expect(state.lesson.facts?.questions).toHaveLength(3 + 1 + 3);
    expect(state.planReport.status.complete).toBe(false);
    expect(state.planReport.status.incomplete).toContain(
      "objective 3: its facts call did not return",
    );
  });

  test("the whole pipeline under --waves: generate, evaluate and repair run on the waves' facts", async () => {
    const ai = labAi({ retrieval });
    const deps = recordingDeps(ai);
    const { status, state } = await runPlannedLessonPipeline({ lesson: romansLesson() }, deps, {
      verify: false,
    });
    expect(status.executed).toBe(true);
    expect(state.lesson.generation?.stage).toBe("repaired");
    expect(state.lesson.slides).toHaveLength(10);
    expect(countOf(ai, "plan-facts-objective")).toBe(0);
    expect(countOf(ai, "verify-facts")).toBe(0);
  });
});
