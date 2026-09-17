import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { costUsd, createAi, DEFAULT_MODEL_IDS } from "@tj/ai";
import { createFakeAi, type FakeAi } from "@tj/ai/testing";
import {
  createDocument,
  deleteDocument,
  forWorkspace,
  getDocument,
  putDocumentAsJob,
} from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import {
  JOB_PROGRESS_STAGES,
  type JobId,
  type LessonId,
  type LessonPlanPayload,
  newId,
  storageKey,
  type WorkspaceId,
} from "@tj/domain";
import { type Lesson, lessonFromBrief, parseLesson } from "@tj/domain/documents";
import { INPUT_CHECK_MESSAGES } from "@tj/generation";
import {
  FIXTURES,
  pipelineScript,
  routed,
  SLIDES_INDEX,
  scriptedPipelineAi,
} from "@tj/generation/testing";
import { NonRetryableError, type ProgressExtra } from "@tj/jobs";
import pino from "pino";
import type { WorkerDeps } from "../deps";
import { SOURCE_UNAVAILABLE_MESSAGE } from "../sources";
import { memoryStorage } from "../testing/memory-storage";
import { lessonPlanJob } from "./lesson-plan";

// Integration test against the compose Postgres (ADR 0014): the lock, the revision guard and the
// per-slide writes are real repository calls, so the handler is exercised with the real `@tj/db`
// rather than a module mock — `mock.module("@tj/db")` would leak into every other test file.
const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping lesson.plan tests: ${t.reason}`);

describeDb("lesson.plan job", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const workspaceId = newId<WorkspaceId>();
  const ws = () => forWorkspace(unsafeDb, workspaceId);
  const quiet = pino({ level: "silent" });

  const depsWith = (
    ai: WorkerDeps["ai"],
    caps?: WorkerDeps["caps"],
    images?: WorkerDeps["images"],
  ): WorkerDeps => ({
    ai,
    db: unsafeDb,
    caps: caps ?? { capUsd: 5, capTokens: 1_000_000 },
    worksheetCapUsd: 0.1,
    storage: memoryStorage(),
    images,
  });

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId });
  });

  /** The row `POST /lessons` writes: a brief, no slides, plan revision 1, locked by `jobId`. */
  async function briefLesson(jobId: JobId, patch: Partial<Lesson> = {}) {
    const lessonId = newId<LessonId>();
    const lesson: Lesson = {
      ...lessonFromBrief(
        { brief: { topic: "States of matter" }, subject: "Science", yearGroup: "Year 8" },
        lessonId,
        new Date("2026-09-06T10:00:00.000Z"),
      ),
      plan: { revision: 1, state: "confirmed", jobId },
      ...patch,
    };
    await createDocument(ws(), "lesson", lesson, { id: lessonId, generatingJobId: jobId });
    return lessonId;
  }

  function ctx(
    jobId: JobId,
    lessonId: LessonId,
    deps: WorkerDeps,
    options: { ac?: AbortController; payload?: Partial<LessonPlanPayload> } = {},
  ) {
    const ac = options.ac ?? new AbortController();
    const calls: Array<[number | undefined, string | undefined, string | undefined]> = [];
    const stages: Array<string | undefined> = [];
    return {
      calls,
      stages,
      ctx: {
        jobId,
        workspaceId,
        payload: { lessonId, revision: 1, ...options.payload } as LessonPlanPayload,
        signal: ac.signal,
        progress: async (percent?: number, message?: string, extra?: ProgressExtra) => {
          calls.push([percent, message, extra?.documentUpdatedAt]);
          stages.push(extra?.stage);
        },
        logger: quiet,
        deps,
      },
    };
  }

  const storedLesson = async (lessonId: LessonId) =>
    parseLesson((await getDocument(ws(), lessonId))?.body);

  test("plans, generates, evaluates and repairs the brief; the row is unlocked; progress carries updatedAt", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const ai = scriptedPipelineAi();
    const h = ctx(jobId, lessonId, depsWith(ai));

    await lessonPlanJob(h.ctx);

    const row = await getDocument(ws(), lessonId);
    expect(row?.generatingJobId).toBeNull();
    const lesson = parseLesson(row?.body);
    expect(lesson.facts).toBeDefined();
    expect(lesson.slides).toHaveLength(FIXTURES.planSkeleton.outline.length);
    expect(lesson.generation?.stage).toBe("repaired");
    expect(lesson.generation?.jobId).toBe(jobId);
    // Slides only (ADR 0030 item 2): no worksheet row, and no worksheet id minted for one.
    expect(lesson.artefacts).toBeUndefined();
    expect(await sql`select id from documents where kind = 'worksheet'`).toHaveLength(0);

    // One progress line per stage plus one per generated slide, each stamped with the row's clock.
    const stamped = h.calls.filter(([, , at]) => at !== undefined);
    expect(stamped.length).toBeGreaterThanOrEqual(9);
    expect(stamped.at(-1)?.[2]).toBe(row?.updatedAt.toISOString());
    const ats = stamped.map(([, , at]) => Date.parse(at ?? ""));
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    // Every progress event names its stage (ADR 0029 item 14).
    expect(h.stages.length).toBe(h.calls.length);
    for (const stage of h.stages) expect(JOB_PROGRESS_STAGES).toContain(stage as never);
    expect(h.stages).toContain("plan");
    expect(h.stages).toContain("generate");
  });

  test("stopAfter planned: Plan and Verify only, the stamped checkpoint, the lock released", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId, {
      plan: { revision: 1, state: "proposed", jobId },
    });
    const ai = scriptedPipelineAi();
    const h = ctx(jobId, lessonId, depsWith(ai), { payload: { stopAfter: "planned" } });

    await lessonPlanJob(h.ctx);

    expect(new Set(ai.calls.map((c) => c.context?.stage))).toEqual(
      new Set(["check-input", "plan"]),
    );
    const lesson = await storedLesson(lessonId);
    expect(lesson.generation?.stage).toBe("planned");
    expect(lesson.generation?.promptVersions.planned).toContain("verify-facts");
    expect(lesson.slides.map((s) => s.kind)).toEqual(["title", "objectives"]);
    expect(lesson.plan).toEqual({ revision: 1, state: "proposed", jobId });
    expect(lesson.artefacts).toBeUndefined();
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
    expect(new Set(h.stages)).toEqual(new Set(["plan"]));
  });

  test("pinObjectives keeps the objectives on the row, ids and text", async () => {
    const jobId = newId<JobId>();
    const pinned = FIXTURES.planSkeleton.learningObjectives.map((o, i) => ({
      id: `o${i + 1}`,
      text: `${o.text} (edited)`,
    }));
    const lessonId = await briefLesson(jobId, {
      plan: { revision: 2, state: "confirmed", jobId },
      facts: {
        objectives: pinned,
        vocabulary: [],
        workedExamples: [],
        questions: [],
        misconceptions: [],
        outline: [],
        durationMin: 60,
      },
    });
    const ai = scriptedPipelineAi();
    const h = ctx(jobId, lessonId, depsWith(ai), {
      payload: { revision: 2, pinObjectives: true, stopAfter: "planned" },
    });

    await lessonPlanJob(h.ctx);

    const lesson = await storedLesson(lessonId);
    expect(lesson.generation?.stage).toBe("planned");
    expect(lesson.facts?.objectives.map(({ id, text }) => ({ id, text }))).toEqual(pinned);
  });

  test("a payload for another plan revision is refused: no write, no model call, lock released", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId, {
      plan: { revision: 2, state: "proposed", jobId },
    });
    const before = await getDocument(ws(), lessonId);
    const ai = scriptedPipelineAi();

    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(ai)).ctx)).rejects.toThrow(
      new NonRetryableError("revision moved"),
    );

    expect(ai.calls).toHaveLength(0);
    const after = await getDocument(ws(), lessonId);
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
    expect(after?.generatingJobId).toBeNull();
  });

  test("a lesson written before plans existed is revision 0 and refused", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId, { plan: undefined });
    const ai = scriptedPipelineAi();

    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(ai)).ctx)).rejects.toThrow(
      "revision moved",
    );
    expect(ai.calls).toHaveLength(0);
  });

  test("illustrate places a pexels photo with provenance on the image-text slide", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    // The fixture's own image-text slide (position 5, TEACH-238): its judge answers for ice cubes.
    const ai = scriptedPipelineAi({
      // The v3 judge (TEACH-220): the pick passes the gate when every mustShow item is visible.
      judges: [
        JSON.stringify({
          pick: "p1",
          onSubject: true,
          clear: true,
          visible: ["ice cubes", "meltwater"],
          count: "one",
          query: null,
        }),
      ],
    });
    const photo = {
      id: "p1",
      width: 4000,
      height: 6000,
      alt: "River",
      photographer: "Ada",
      photographerUrl: "https://www.pexels.com/@ada/",
      pageUrl: "https://www.pexels.com/photo/p1/",
      src: {
        large: "https://images.pexels.com/photos/p1/large.jpeg",
        medium: "https://images.pexels.com/photos/p1/medium.jpeg",
        tiny: "https://images.pexels.com/photos/p1/tiny.jpeg",
      },
    };
    const puts: { key: string; contentType: string }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "3" },
      });
    }) as unknown as typeof globalThis.fetch;
    try {
      const h = ctx(
        jobId,
        lessonId,
        depsWith(ai, undefined, {
          client: {
            search: async () => ({ photos: [photo], nextPage: null }),
            photo: async () => null,
          },
          storage: {
            put: async (key: string, _body: Uint8Array, opts: { contentType: string }) => {
              puts.push({ key, contentType: opts.contentType });
              return { key };
            },
            getSignedUrl: () => Promise.reject(new Error("unused")),
            delete: () => Promise.reject(new Error("unused")),
            list: () => (async function* () {})(),
          },
        }),
      );

      await lessonPlanJob(h.ctx);
    } finally {
      globalThis.fetch = realFetch;
    }

    const lesson = parseLesson((await getDocument(ws(), lessonId))?.body);
    const slide = lesson.slides.find((s) => s.kind === "image-text");
    const element = slide?.elements.find((el) => el.type === "image");
    expect(
      element?.type === "image" && element.src.startsWith(`/files/${workspaceId}/images/`),
    ).toBe(true);
    expect(element?.type === "image" && element.source?.provider).toBe("pexels");
    expect(element?.type === "image" && element.source?.evidence?.visible).toEqual([
      "ice cubes",
      "meltwater",
    ]);
    expect(element?.type === "image" && element.authoredBy).toBe("ai");
  });

  test("without a pexels key the image deps are disabled and the pipeline still runs", async () => {
    const { createWorkerDeps } = await import("../deps");
    const { parseEnv } = await import("../env");
    const deps = createWorkerDeps(
      parseEnv({ DATABASE_URL: "postgres://postgres:postgres@localhost:5432/teaching_journey" }),
      quiet,
      unsafeDb,
    );
    expect(deps.images).toBeUndefined();
    expect(deps.storageKind).toBeDefined();
  });

  test("a row locked by another job is a NonRetryableError: no write, no model call", async () => {
    const jobId = newId<JobId>();
    const otherJobId = newId<JobId>();
    const lessonId = await briefLesson(otherJobId);
    const before = await getDocument(ws(), lessonId);
    const ai = scriptedPipelineAi();

    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(ai)).ctx)).rejects.toThrow(
      NonRetryableError,
    );

    expect(ai.calls).toHaveLength(0);
    const after = await getDocument(ws(), lessonId);
    expect(after?.generatingJobId).toBe(otherJobId);
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
  });

  test("a row hard-deleted before the job runs is `lesson missing`; `finally` does not throw", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    await deleteDocument(ws(), lessonId);
    const ai = scriptedPipelineAi();

    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(ai)).ctx)).rejects.toThrow(
      "lesson missing",
    );
    expect(ai.calls).toHaveLength(0);
  });

  test("a failed Evaluate keeps the locks; the retry resumes after `generated` without re-planning", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    // Evaluate is the call after check + plan + 9 slides; make it blow up as the provider. The
    // script is routed: slide replies are matched by shape, since Generate runs them in parallel
    // (TEACH-213), and the throwing entry is left for Evaluate.
    const evaluateIndex = SLIDES_INDEX + FIXTURES.planSkeleton.outline.length - 2;
    const first: FakeAi = createFakeAi({
      script: routed(
        pipelineScript({
          overrides: {
            [evaluateIndex]: () => {
              throw new Error("provider unreachable");
            },
          },
        }),
      ),
    });

    // `@tj/ai` wraps provider failures as a retryable `AiError`; the handler rethrows it as-is.
    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(first)).ctx)).rejects.toThrow(
      "Bedrock model call failed",
    );
    const mid = await storedLesson(lessonId);
    expect(mid.generation?.stage).toBe("generated");
    const priorUsage = mid.generation?.usage;
    if (!priorUsage || priorUsage.costUsd === null)
      throw new Error("Missing priced checkpoint usage");
    expect(priorUsage.calls).toBeGreaterThan(0);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBe(jobId);

    const second = createFakeAi({
      usage: { inputTokens: 1000, outputTokens: 400 },
      script: routed(pipelineScript().slice(evaluateIndex)),
    });
    const resumed = ctx(jobId, lessonId, depsWith(second));
    const logs: string[] = [];
    resumed.ctx.logger = pino(
      { level: "info" },
      {
        write: (line) => {
          logs.push(line);
        },
      },
    );
    await lessonPlanJob(resumed.ctx);

    expect(second.calls.map((c) => c.context?.stage)).toEqual(["evaluate"]);
    const done = await storedLesson(lessonId);
    expect(done.generation?.usage?.calls).toBe(priorUsage.calls + second.calls.length);
    expect(done.generation?.usage?.inputTokens).toBe(priorUsage.inputTokens + 1000);
    expect(done.generation?.usage?.outputTokens).toBe(priorUsage.outputTokens + 400);
    expect(done.generation?.usage?.costUsd).toBeCloseTo(
      priorUsage.costUsd +
        (costUsd(DEFAULT_MODEL_IDS.standard, { inputTokens: 1000, outputTokens: 400 }) ?? 0),
      10,
    );
    const summary = logs
      .map((line) => JSON.parse(line))
      .find((line) => line.msg === "generation summary");
    expect(summary).toMatchObject({ resumed: true, usagePriorUsd: priorUsage.costUsd });
    expect(done.generation?.stage).toBe("repaired");
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test.each(["confirmed", "uncertain", "reserved"] as const)(
    "a resumed Lesson at its USD cap including %s usage dispatches no model call",
    async (kind) => {
      const jobId = newId<JobId>();
      const lessonId = await briefLesson(jobId);
      const evaluateIndex = SLIDES_INDEX + FIXTURES.planSkeleton.outline.length - 2;
      const first = createFakeAi({
        script: routed(
          pipelineScript({
            overrides: {
              [evaluateIndex]: () => {
                throw new Error("synthetic provider outage");
              },
            },
          }),
        ),
      });
      await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(first)).ctx)).rejects.toThrow();
      const checkpoint = await storedLesson(lessonId);
      let prior = checkpoint.generation?.usage;
      if (!prior || prior.costUsd === null) throw new Error("Missing checkpoint usage");
      let capUsd = prior.costUsd;
      if (kind !== "confirmed") {
        const held = { calls: 1, inputTokens: 5000, outputTokens: 100, costUsd: 0.5 };
        prior = { ...prior, [kind]: held };
        if (!checkpoint.generation) throw new Error("Missing checkpoint");
        const written = await putDocumentAsJob(
          ws(),
          lessonId,
          { ...checkpoint, generation: { ...checkpoint.generation, usage: prior } },
          jobId,
        );
        expect(written.status).toBe("ok");
        capUsd += held.costUsd;
        // Reservations from a dead attempt become uncertain on resume, never free capacity.
        if (kind === "reserved") {
          const { reserved: _reserved, ...known } = prior;
          prior = { ...known, uncertain: held };
        }
      }
      const resumed = createFakeAi({ error: new Error("No model should be dispatched") });
      await lessonPlanJob(
        ctx(jobId, lessonId, depsWith(resumed, { capUsd, capTokens: 1_000_000 })).ctx,
      );
      expect(resumed.calls).toHaveLength(0);
      const done = await storedLesson(lessonId);
      expect(done.generation?.usage).toEqual(prior);
      expect(done.generation?.findings.some((finding) => finding.check === "budget")).toBe(true);
    },
  );

  test("an unconfigured provider is a NonRetryableError and releases the lock", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const deps = depsWith(createAi({}, { logger: quiet }));
    expect(deps.ai.kind).toBe("unconfigured");

    await expect(lessonPlanJob(ctx(jobId, lessonId, deps).ctx)).rejects.toThrow(NonRetryableError);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test("a brief the input check refuses is a NonRetryableError with the finding's message; nothing written, locks released", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const before = await getDocument(ws(), lessonId);
    const ai = scriptedPipelineAi({
      checkInput: {
        findings: [
          {
            check: "learner-name",
            severity: "error",
            target: {},
            message: "The brief seems to name a pupil. Please reword it.",
          },
        ],
      },
    });

    // The job-visible message is the fixed per-check text, not what the model wrote.
    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(ai)).ctx)).rejects.toThrow(
      new NonRetryableError(INPUT_CHECK_MESSAGES["learner-name"]),
    );

    expect(ai.calls.map((c) => c.context?.stage)).toEqual(["check-input"]);
    const after = await getDocument(ws(), lessonId);
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
    expect(after?.generatingJobId).toBeNull();
  });

  test("a lesson whose Source has no extracted.json fails non-retryably before any model call; locks released", async () => {
    const jobId = newId<JobId>();
    const sourceId = newId();
    const lessonId = await briefLesson(jobId, {
      sources: [{ id: sourceId, kind: "file", name: "plants.pdf", pages: 2 }],
    });
    const before = await getDocument(ws(), lessonId);
    const ai = scriptedPipelineAi();

    await expect(lessonPlanJob(ctx(jobId, lessonId, depsWith(ai)).ctx)).rejects.toThrow(
      new NonRetryableError(SOURCE_UNAVAILABLE_MESSAGE),
    );

    // Check input runs first (the brief), then Plan asks for the Source and stops.
    expect(ai.calls.map((c) => c.context?.stage)).toEqual(["check-input"]);
    const after = await getDocument(ws(), lessonId);
    expect(after?.generatingJobId).toBeNull();
    expect(after?.updatedAt.getTime()).toBeGreaterThanOrEqual(before?.updatedAt.getTime() ?? 0);
  });

  test("a lesson with a Source reads its extracted.json and Plan sees the passages", async () => {
    const jobId = newId<JobId>();
    const sourceId = newId();
    const lessonId = await briefLesson(jobId, {
      sources: [{ id: sourceId, kind: "file", name: "plants.pdf", pages: 1 }],
    });
    const storage = memoryStorage({
      [storageKey(workspaceId, "sources", sourceId, "extracted.json")]: JSON.stringify({
        version: 1,
        sourceId,
        kind: "pdf",
        pages: 1,
        lowText: false,
        chunks: [
          {
            ref: { page: 1 },
            text: "Solids keep their shape; liquids take the shape of their container.",
          },
        ],
        images: [],
      }),
    });
    const ai = scriptedPipelineAi();
    const deps = { ...depsWith(ai), storage };

    await lessonPlanJob(ctx(jobId, lessonId, deps).ctx);

    const planCall = ai.calls.find((c) => c.context?.stage === "plan");
    expect(planCall?.promptText).toContain(`[${sourceId} p.1] Solids keep their shape`);
    expect((await storedLesson(lessonId)).slides.length).toBeGreaterThan(2);
  });

  test("a cancel during Generate keeps the slides so far and releases the locks", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const ac = new AbortController();
    // Cancel while the fifth slide's answer is pending: four slides are already on the row.
    const script = pipelineScript();
    const pending = SLIDES_INDEX + 2;
    script[pending] = async (_call) => {
      ac.abort("cancelled");
      return script[pending - 1] as string;
    };
    const ai = createFakeAi({ script });

    await lessonPlanJob(ctx(jobId, lessonId, depsWith(ai), { ac }).ctx);

    const lesson = await storedLesson(lessonId);
    expect(lesson.generation?.stage).toBe("planned");
    expect(lesson.slides.length).toBeGreaterThanOrEqual(2);
    expect(lesson.slides.length).toBeLessThan(FIXTURES.planSkeleton.outline.length);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test("a pre-skeleton reservation refusal retains the title and releases the lock without retry", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const ai = scriptedPipelineAi();

    // This once overshot the cap on the skeleton call. Admission now refuses that call instead.
    const fakeUsage = { inputTokens: 1000, outputTokens: 400 };
    const callUsd = (cls: "small" | "standard") => costUsd(DEFAULT_MODEL_IDS[cls], fakeUsage) ?? 0;
    const capUsd = callUsd("small") + callUsd("standard") / 2;
    await expect(
      lessonPlanJob(ctx(jobId, lessonId, depsWith(ai, { capUsd, capTokens: 1_000_000 })).ctx),
    ).rejects.toBeInstanceOf(NonRetryableError);

    expect(ai.calls).toHaveLength(1);
    const lesson = await storedLesson(lessonId);
    expect(lesson.generation).toBeUndefined();
    expect(lesson.slides).toHaveLength(1);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test("does nothing but release the lock when already cancelled", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const ac = new AbortController();
    ac.abort("cancelled");
    const ai = scriptedPipelineAi();
    const h = ctx(jobId, lessonId, depsWith(ai), { ac });

    await lessonPlanJob(h.ctx);

    expect(h.calls).toEqual([]);
    expect(ai.calls).toHaveLength(0);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test("a shutdown abort keeps the lock for pg-boss's retry", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const ac = new AbortController();
    ac.abort("shutdown");

    await lessonPlanJob(ctx(jobId, lessonId, depsWith(scriptedPipelineAi()), { ac }).ctx);

    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBe(jobId);
  });

  test("another Workspace's lesson is untouched", async () => {
    const jobId = newId<JobId>();
    const lessonId = await briefLesson(jobId);
    const foreign = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: foreign });
    const h = ctx(jobId, lessonId, depsWith(scriptedPipelineAi()));
    h.ctx.workspaceId = foreign;

    await expect(lessonPlanJob(h.ctx)).rejects.toThrow("lesson missing");

    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBe(jobId);
  });
});
