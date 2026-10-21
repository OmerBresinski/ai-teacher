import { describe, expect, spyOn, test } from "bun:test";
import pino from "pino";
import {
  type AiGeneration,
  createObservability,
  distinctIdFor,
  type LessonSummary,
  type ObservabilityFetch,
  SYSTEM_DISTINCT_ID,
} from "./observability";

const PROMPT = "PROMPT-SENTINEL write a lesson about volcanoes";
const OUTPUT = "OUTPUT-SENTINEL Volcanoes erupt when magma rises";
const WORKSPACE = "0d9f3c1e-5b7a-4c2d-9e8f-1a2b3c4d5e6f";
const JOB = "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const LESSON = "0192f7a0-0000-7000-8000-000000000042";
const MODELS = ["openai/gpt-6-luna"];

interface Sent {
  url: string;
  text: string;
  events: Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }>;
}

/** A transport double: records every batch, decoding the gzip body the client may send. */
function recordingFetch(answer: () => Promise<Response> = async () => new Response("{}")) {
  const sent: Sent[] = [];
  const fetch: ObservabilityFetch = async (url, options) => {
    const body = options.body as unknown;
    let text: string;
    if (typeof body === "string") text = body;
    else {
      const bytes =
        body instanceof Blob
          ? new Uint8Array(await body.arrayBuffer())
          : new Uint8Array(body as ArrayBuffer);
      text =
        options.headers["Content-Encoding"] === "gzip"
          ? new TextDecoder().decode(Bun.gunzipSync(bytes))
          : new TextDecoder().decode(bytes);
    }
    const parsed = JSON.parse(text) as { batch?: Sent["events"] };
    sent.push({ url, text, events: parsed.batch ?? [] });
    const res = await answer();
    return { status: res.status, text: () => res.text(), json: () => res.json() } as never;
  };
  return { fetch, sent };
}

function captureLogger() {
  const lines: Array<Record<string, unknown>> = [];
  const logger = pino(
    { level: "debug" },
    { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
  );
  return { logger, lines };
}

const call: AiGeneration = {
  modelId: "openai/gpt-6-luna",
  provider: "openai.chat",
  modelClass: "standard",
  durationMs: 1234,
  inputTokens: 1000,
  outputTokens: 200,
  cachedInputTokens: 800,
  costUsd: 0.0021,
  finishReason: "stop",
  isError: false,
  lessonId: LESSON,
  jobId: JOB,
  stage: "write",
  promptVersion: "writer-v4.8",
  effort: "low",
};

const summary: LessonSummary = {
  lessonId: LESSON,
  jobId: JOB,
  outcome: "success",
  planner: "writer",
  stages: ["write", "illustrate", "evaluate"],
  costUsd: 0.031,
  calls: 7,
  inputTokens: 40_000,
  outputTokens: 9_000,
  durationMs: 61_000,
  readableMs: 30_000,
  checkedMs: 55_000,
  findings: { error: 0, warning: 2 },
  images: { photographable: true, requested: 4, placed: 3, empty: 1, failed: 0 },
};

describe("createObservability without a key", () => {
  test("is a no-op that never touches the transport", async () => {
    const { fetch, sent } = recordingFetch();
    for (const apiKey of [undefined, "", "   "]) {
      const obs = createObservability({
        apiKey,
        logger: pino({ level: "silent" }),
        service: "w",
        fetch,
      });
      expect(obs.enabled).toBe(false);
      obs.beginJob(JOB, { workspaceId: WORKSPACE, job: "lesson.generate" })();
      obs.captureAiGeneration(call);
      obs.captureLessonSummary(summary);
      obs.captureJobFailure({
        error: new Error("x"),
        job: "lesson.plan",
        jobId: JOB,
        attempt: 0,
        willRetry: false,
      });
      obs.captureException(new Error("boom"), "uncaughtException");
      await obs.flush();
      await obs.shutdown();
    }
    expect(sent).toHaveLength(0);
  });
});

describe("createObservability with a key (mocked transport)", () => {
  test("$ai_generation carries metadata and no prompt or output fields", async () => {
    const { fetch, sent } = recordingFetch();
    const obs = createObservability({
      apiKey: "phc_test",
      modelIds: MODELS,
      logger: pino({ level: "silent" }),
      service: "worker",
      fetch,
    });
    const end = obs.beginJob(JOB, {
      workspaceId: WORKSPACE,
      job: "lesson.generate",
      lessonId: LESSON,
    });
    // A caller that slips content in must not get it through: properties are an allow-list.
    obs.captureAiGeneration({
      ...call,
      prompt: PROMPT,
      output: OUTPUT,
      messages: [PROMPT],
    } as AiGeneration);
    end();
    await obs.flush();

    const events = sent.flatMap((s) => s.events);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.event).toBe("$ai_generation");
    expect(event?.distinct_id).toBe(distinctIdFor(WORKSPACE));
    const p = event?.properties ?? {};
    expect(p).toMatchObject({
      $ai_trace_id: JOB,
      $ai_model: "openai/gpt-6-luna",
      $ai_provider: "openai.chat",
      $ai_input_tokens: 1000,
      $ai_output_tokens: 200,
      $ai_cache_read_input_tokens: 800,
      $ai_total_cost_usd: 0.0021,
      $ai_latency: 1.234,
      $ai_stop_reason: "stop",
      $ai_is_error: false,
      $ai_span_name: "write",
      lessonId: LESSON,
      jobId: JOB,
      stage: "write",
      promptVersion: "writer-v4.8",
      $process_person_profile: false,
    });
    for (const key of [
      "$ai_input",
      "$ai_output_choices",
      "$ai_output",
      "prompt",
      "output",
      "messages",
    ]) {
      expect(p).not.toHaveProperty(key);
    }
    const all = sent.map((s) => s.text).join("\n");
    expect(all).not.toContain("PROMPT-SENTINEL");
    expect(all).not.toContain("OUTPUT-SENTINEL");
    // The distinct id is a hash: the Workspace id itself is never sent.
    expect(all).not.toContain(WORKSPACE);
    expect(sent[0]?.url).toStartWith("https://eu.i.posthog.com/");
    await obs.shutdown();
  });

  test("the lesson summary event carries outcome, cost, timings, findings and images only", async () => {
    const { fetch, sent } = recordingFetch();
    const obs = createObservability({
      apiKey: "phc_test",
      modelIds: MODELS,
      logger: pino({ level: "silent" }),
      service: "worker",
      fetch,
    });
    obs.beginJob(JOB, { workspaceId: WORKSPACE, job: "lesson.generate", lessonId: LESSON });
    obs.captureLessonSummary({ ...summary, lesson: { title: OUTPUT } } as LessonSummary);
    await obs.flush();
    const [event] = sent.flatMap((s) => s.events);
    expect(event?.event).toBe("gen_lesson");
    expect(event?.properties).toMatchObject({
      outcome: "success",
      planner: "writer",
      costUsd: 0.031,
      durationMs: 61_000,
      readableMs: 30_000,
      checkedMs: 55_000,
      findingsError: 0,
      findingsWarning: 2,
      imagesPlaced: 3,
      imagesRequested: 4,
      lessonId: LESSON,
      $ai_trace_id: JOB,
    });
    expect(event?.properties).not.toHaveProperty("lesson");
    expect(sent.map((s) => s.text).join("\n")).not.toContain("OUTPUT-SENTINEL");
    await obs.shutdown();
  });

  test("a job failure is an exception with a stack, job context and no foreign message", async () => {
    const { fetch, sent } = recordingFetch();
    const obs = createObservability({
      apiKey: "phc_test",
      modelIds: MODELS,
      logger: pino({ level: "silent" }),
      service: "worker",
      fetch,
    });
    obs.beginJob(JOB, { workspaceId: WORKSPACE, job: "lesson.generate", lessonId: LESSON });
    // The last model call names the stage the failure happened in.
    obs.captureAiGeneration(call);
    const foreign = new SyntaxError(`Unexpected token in JSON: ${OUTPUT}`);
    obs.captureJobFailure({
      error: foreign,
      job: "lesson.generate",
      jobId: JOB,
      attempt: 1,
      willRetry: true,
      planner: "writer",
    });
    await obs.flush();

    const exception = sent.flatMap((s) => s.events).find((e) => e.event === "$exception");
    expect(exception).toBeDefined();
    const p = exception?.properties ?? {};
    expect(p).toMatchObject({
      source: "job",
      job: "lesson.generate",
      jobId: JOB,
      lessonId: LESSON,
      stage: "write",
      planner: "writer",
      attempt: 1,
      willRetry: true,
      errorType: "SyntaxError",
    });
    const list = p.$exception_list as Array<{
      type: string;
      value: string;
      stacktrace?: { frames?: unknown[] };
    }>;
    expect(list[0]?.type).toBe("SyntaxError");
    expect(list[0]?.value).toBe("SyntaxError");
    expect(list[0]?.stacktrace?.frames?.length ?? 0).toBeGreaterThan(0);
    expect(exception?.distinct_id).toBe(distinctIdFor(WORKSPACE));
    expect(sent.map((s) => s.text).join("\n")).not.toContain("OUTPUT-SENTINEL");
    await obs.shutdown();
  });

  test("our own message is kept, with a URL's token and a key scrubbed", async () => {
    const { fetch, sent } = recordingFetch();
    const obs = createObservability({
      apiKey: "phc_test",
      modelIds: MODELS,
      logger: pino({ level: "silent" }),
      service: "worker",
      fetch,
    });
    const own = new Error(
      "fetch https://bucket.example.com/img.png?X-Amz-Signature=abcdef0123456789abcdef0123456789 failed with key sk-proj-AbCdEf1234567890",
    );
    own.name = "StageFailure";
    obs.captureException(own, "uncaughtException");
    await obs.flush();
    const exception = sent.flatMap((s) => s.events).find((e) => e.event === "$exception");
    expect(exception?.distinct_id).toBe(SYSTEM_DISTINCT_ID);
    const value = (
      exception?.properties.$exception_list as Array<{ value: string }> | undefined
    )?.[0]?.value;
    // Not even our own message is sent: the type alone.
    expect(value).toBe("StageFailure");
    const all = sent.map((s) => s.text).join("\n");
    expect(all).not.toContain("bucket.example.com");
    expect(all).not.toContain("X-Amz-Signature");
    expect(all).not.toContain("sk-proj-AbCdEf1234567890");
    await obs.shutdown();
  });

  test("a failing transport never throws and is logged once", async () => {
    const { logger, lines } = captureLogger();
    // A stub, never the network. posthog-core prints each failed batch with console.error
    // (whatever listeners are set); held here so CI output shows no stray stack traces.
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const { fetch } = recordingFetch(async () => {
      throw new Error("stub transport: connection refused");
    });
    const obs = createObservability({
      apiKey: "phc_test",
      modelIds: MODELS,
      logger,
      service: "worker",
      fetch,
    });
    obs.captureAiGeneration(call);
    await obs.flush();
    obs.captureAiGeneration(call);
    await obs.flush();
    await obs.shutdown();
    const printed = [...consoleError.mock.calls];
    consoleError.mockRestore();
    for (const [first] of printed) {
      expect(String(first)).toMatch(/^(Error while flushing PostHog|\[PostHog\])/);
    }
    const warnings = lines.filter((l) => l.msg === "posthog send failed; events dropped");
    expect(warnings).toHaveLength(1);
  });

  test("a hanging transport is cut off by the flush timeout", async () => {
    const { logger, lines } = captureLogger();
    // Released at the end, so no request outlives the test and prints into a later one.
    const hanging: Array<(error: Error) => void> = [];
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const { fetch } = recordingFetch(
      () => new Promise<Response>((_resolve, reject) => void hanging.push(reject)),
    );
    const obs = createObservability({
      apiKey: "phc_test",
      modelIds: MODELS,
      logger,
      service: "worker",
      fetch,
      flushTimeoutMs: 100,
      requestTimeoutMs: 10_000,
    });
    obs.captureAiGeneration(call);
    const started = Date.now();
    await obs.flush();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(lines.some((l) => l.msg === "posthog flush timed out; events dropped")).toBe(true);
    const stopping = Date.now();
    await obs.shutdown();
    expect(Date.now() - stopping).toBeLessThan(1500);
    for (const reject of hanging) reject(new Error("stub transport: test over"));
    await Bun.sleep(20);
    consoleError.mockRestore();
  });
});

describe("gen_* events from log lines", () => {
  test("writer, pipeline and message lines become gen_* events with metadata only", async () => {
    const { fetch, sent } = recordingFetch();
    const obs = createObservability({
      apiKey: "phc_test",
      modelIds: MODELS,
      logger: pino({ level: "silent" }),
      service: "worker",
      fetch,
    });
    obs.beginJob(JOB, {
      workspaceId: WORKSPACE,
      job: "lesson.generate",
      lessonId: LESSON,
      capUsd: 0.5,
    });
    const b = {
      jobId: JOB,
      job: "lesson.generate",
      attempt: 1,
      resumed: true,
      workspaceId: WORKSPACE,
    };
    // A writer repair line: `fix` is the model's own words and must never be sent.
    obs.captureLogLine(
      b,
      { writer: { ev: "repair", slide: 3, mode: "fit", ok: true, reverted: true, fix: OUTPUT } },
      "writer stage",
    );
    obs.captureLogLine(
      b,
      {
        ev: "stage",
        stage: "write",
        outcome: "done",
        startedAt: "2026-10-20T10:00:00.000Z",
        durationMs: 4200,
      },
      "generation stage timeline",
    );
    obs.captureLogLine(
      b,
      {
        ev: "fact-check",
        outcome: "checked",
        factsChecked: 10,
        corrections: 3,
        factsChanged: 2,
        wordsChanged: 7,
        field_answer: 2,
        field_stem: 1,
        reason_wrong_term: 3,
      },
      "facts verified",
    );
    obs.captureLogLine(b, { stage: "illustrate", slideIndex: 4 }, "illustrate budget stop");
    obs.captureLogLine(
      b,
      {
        ev: "picture-outcome",
        via: "pexels",
        attempts: 2,
        reason: "nothing fit the slide",
        query: "volcano",
      },
      "picture outcome",
    );
    obs.captureLogLine(b, {}, "job failed; pg-boss will retry");
    // Not job events: no jobId, a line with no ev and no known message, the summary line.
    obs.captureLogLine({}, { ev: "stage" }, "x");
    obs.captureLogLine(b, { ai: { modelId: "m" } }, undefined);
    obs.captureLogLine(b, { generation: {} }, "generation summary");
    obs.captureJobEvent(JOB, "gen_job", { status: "picked", queueWaitMs: 850, prompt: PROMPT });
    obs.captureLessonSummary(summary);
    await obs.flush();

    const events = sent.flatMap((s) => s.events);
    expect(events.map((e) => e.event)).toEqual([
      "gen_repair",
      "gen_stage",
      "gen_fact_check",
      "gen_budget_stop",
      "gen_picture_outcome",
      "gen_job",
      "gen_job",
      "gen_lesson",
      // The picture line above rolls up into the lesson's pictures row.
      "gen_lesson_pictures",
    ]);
    for (const e of events) {
      expect(e.distinct_id).toBe(distinctIdFor(WORKSPACE));
      expect(e.properties.$ai_trace_id).toBe(JOB);
      for (const key of [
        "$ai_input",
        "$ai_output_choices",
        "fix",
        "prompt",
        "query",
        "text",
        "output",
      ]) {
        expect(e.properties).not.toHaveProperty(key);
      }
    }
    const byName = (n: string) => events.find((e) => e.event === n)?.properties ?? {};
    expect(byName("gen_repair")).toMatchObject({
      slide: 3,
      mode: "fit",
      ok: true,
      reverted: true,
      source: "writer",
      attempt: 1,
      resumed: true,
      lessonId: LESSON,
    });
    expect(byName("gen_stage")).toMatchObject({
      stage: "write",
      outcome: "done",
      durationMs: 4200,
    });
    expect(byName("gen_fact_check")).toMatchObject({
      factsChecked: 10,
      corrections: 3,
      field_answer: 2,
      field_stem: 1,
      reason_wrong_term: 3,
    });
    expect(byName("gen_budget_stop")).toMatchObject({
      stage: "illustrate",
      slideIndex: 4,
      spentUsd: 0,
      capUsd: 0.5,
    });
    // A sentence is not an identifier: the free-text reason is dropped, the codes stay.
    expect(byName("gen_picture_outcome")).toMatchObject({ via: "pexels", attempts: 2 });
    expect(byName("gen_picture_outcome")).not.toHaveProperty("reason");
    expect(events.filter((e) => e.event === "gen_job").map((e) => e.properties.status)).toEqual([
      "retry",
      "picked",
    ]);
    expect(byName("gen_lesson")).toMatchObject({
      factChecks: 1,
      factsChecked: 10,
      factsCorrected: 3,
      factsChanged: 2,
      factWordsChanged: 7,
      factChangeRate: 0.2,
      repairs: 1,
      repairsReverted: 1,
    });
    const all = sent.map((s) => s.text).join("\n");
    for (const sentinel of [
      "OUTPUT-SENTINEL",
      "PROMPT-SENTINEL",
      "volcano",
      "nothing fit",
      WORKSPACE,
    ]) {
      expect(all).not.toContain(sentinel);
    }
    await obs.shutdown();
  });
});

describe("content never leaves through a gen_* event (review of #603)", () => {
  test("a one-word title, an email and a model-written reason appear nowhere in the payload", async () => {
    const { fetch, sent } = recordingFetch();
    const obs = createObservability({
      apiKey: "phc_test",
      modelIds: MODELS,
      logger: pino({ level: "silent" }),
      service: "worker",
      fetch,
    });
    obs.beginJob(JOB, { workspaceId: WORKSPACE, job: "lesson.generate", lessonId: LESSON });
    const b = { jobId: JOB, job: "lesson.generate", attempt: 0 };
    const TITLE = "Photosynthesis";
    const EMAIL = "teacher@school.example";
    const MODEL_REASON = "the model thinks chlorophyll is blue";
    // Identifier-shaped strings under keys that are not on the event's list, or whose rule they fail.
    obs.captureLogLine(
      b,
      {
        writer: {
          ev: "repair",
          slide: 2,
          mode: "fit",
          ok: true,
          lessonTitle: TITLE,
          key: TITLE,
          fault: EMAIL,
        },
      },
      "writer stage",
    );
    obs.captureLogLine(b, { ev: "stage", stage: TITLE, outcome: "done", owner: EMAIL }, "timeline");
    obs.captureLogLine(
      b,
      { ev: "picture-outcome", via: TITLE, outcome: "placed", reason: MODEL_REASON, key: EMAIL },
      "picture outcome",
    );
    // Model text as a property name and as a value.
    obs.captureLogLine(
      b,
      {
        ev: "fact-check",
        outcome: "checked",
        corrections: 1,
        byReason: { [MODEL_REASON]: 1 },
        [MODEL_REASON]: 1,
        reason: MODEL_REASON,
      },
      "facts verified",
    );
    obs.captureJobEvent(JOB, "gen_job", {
      status: "picked",
      queueWaitMs: 5,
      topic: TITLE,
      contact: EMAIL,
    });
    obs.captureAiGeneration({ ...call, modelId: TITLE, promptVersion: TITLE, stage: TITLE });
    obs.captureJobFailure({
      error: new Error(`${TITLE} ${EMAIL} ${MODEL_REASON}`),
      job: "lesson.generate",
      jobId: JOB,
      attempt: 0,
      willRetry: false,
      stage: TITLE,
      planner: EMAIL,
    });
    await obs.flush();

    const all = sent.map((s) => s.text).join("\n");
    expect(sent.flatMap((s) => s.events).length).toBeGreaterThanOrEqual(7);
    for (const leak of [
      TITLE,
      TITLE.toLowerCase(),
      EMAIL,
      "school.example",
      MODEL_REASON,
      "chlorophyll",
    ]) {
      expect(all).not.toContain(leak);
    }
    const events = sent.flatMap((s) => s.events);
    const repair = events.find((e) => e.event === "gen_repair")?.properties ?? {};
    expect(repair).toMatchObject({ slide: 2, mode: "fit", ok: true, droppedProps: 3 });
    for (const e of events) {
      for (const key of Object.keys(e.properties)) expect(key).not.toContain(" ");
    }
    await obs.shutdown();
  });
});

describe("distinctIdFor", () => {
  test("is a stable hash, never the Workspace id", () => {
    expect(distinctIdFor(WORKSPACE)).toBe(distinctIdFor(WORKSPACE));
    expect(distinctIdFor(WORKSPACE)).toMatch(/^ws_[0-9a-f]{32}$/);
    expect(distinctIdFor(WORKSPACE)).not.toContain(WORKSPACE.slice(0, 8));
    expect(distinctIdFor(undefined)).toBe(SYSTEM_DISTINCT_ID);
  });
});

describe("lesson pictures (gen_picture_outcome, gen_lesson_pictures)", () => {
  const PROMPT_TEXT = "IMAGE-PROMPT-SENTINEL a hen beside a chick on straw";
  const JUDGE_WHY = "JUDGE-WHY-SENTINEL the chick is cut off at the left";
  const SRC = "/files/ws/images/0192f7a0-0000-7000-8000-00000000abcd.png";
  /** One slot's outcome line as the pipeline logs it, plus the content a careless caller might add. */
  const slot = (over: Record<string, unknown> = {}) => ({
    stage: "illustrate",
    ev: "picture-outcome",
    kind: "single",
    slideIndex: 3,
    outcome: "placed",
    via: "generated",
    attempts: 2,
    reason: "judge",
    director: "library-or-generate",
    route: "generic",
    sourceKind: "generated",
    pictureKind: "object",
    lessonSubject: "science",
    keyStage: "ks2",
    promptVersion: "picture-director-batch.v2",
    framingClause: true,
    library: "refused",
    latencyMs: 41_000,
    retryReasons: ["judge"],
    failedChecks: ["misfit", "items-missing"],
    judgeRefusals: 1,
    pictureCostUsd: 0.08,
    frameMeasured: true,
    backdrop: "plain",
    frameCut: true,
    cutEdges: 2,
    frameBleed: 0.41,
    frameMs: 18.2,
    cutsSeen: 1,
    // Content: never sent.
    imagePrompt: PROMPT_TEXT,
    why: JUDGE_WHY,
    src: SRC,
    tries: [{ result: "judge", why: JUDGE_WHY, src: SRC }],
    ...over,
  });

  test("a slot's outcome carries its codes and numbers, and no prompt, judge reason or url", async () => {
    const { fetch, sent } = recordingFetch();
    const obs = createObservability({
      apiKey: "phc_test",
      modelIds: MODELS,
      logger: pino({ level: "silent" }),
      service: "worker",
      fetch,
    });
    obs.beginJob(JOB, { workspaceId: WORKSPACE, job: "lesson.generate", lessonId: LESSON });
    const b = { jobId: JOB, job: "lesson.generate", attempt: 0 };
    obs.captureLogLine(b, slot(), "picture outcome");
    // Free text where a code belongs is dropped, never sent.
    obs.captureLogLine(
      b,
      slot({
        pictureKind: PROMPT_TEXT,
        reason: JUDGE_WHY,
        failedChecks: [JUDGE_WHY],
        lessonSubject: "Volcanoes of Iceland",
        sourceKind: SRC,
      }),
      "picture outcome",
    );
    await obs.flush();
    const all = sent.map((s) => s.text).join("\n");
    for (const leak of [
      PROMPT_TEXT,
      "IMAGE-PROMPT",
      JUDGE_WHY,
      "JUDGE-WHY",
      SRC,
      "/files/",
      "Iceland",
    ])
      expect(all).not.toContain(leak);
    const outs = sent.flatMap((s) => s.events).filter((e) => e.event === "gen_picture_outcome");
    expect(outs).toHaveLength(2);
    expect(outs[0]?.properties).toMatchObject({
      outcome: "placed",
      via: "generated",
      reason: "judge",
      sourceKind: "generated",
      pictureKind: "object",
      lessonSubject: "science",
      keyStage: "ks2",
      promptVersion: "picture-director-batch.v2",
      framingClause: true,
      retryReasons: ["judge"],
      failedChecks: ["misfit", "items-missing"],
      frameCut: true,
      cutEdges: 2,
      backdrop: "plain",
      pictureCostUsd: 0.08,
      droppedProps: 4,
    });
    expect(outs[1]?.properties).not.toHaveProperty("pictureKind");
    expect(outs[1]?.properties).not.toHaveProperty("reason");
    expect(outs[1]?.properties.droppedProps).toBe(4 + 5);
    await obs.shutdown();
  });

  test("the lesson's pictures roll up into one gen_lesson_pictures row", async () => {
    const { fetch, sent } = recordingFetch();
    const obs = createObservability({
      apiKey: "phc_test",
      modelIds: MODELS,
      logger: pino({ level: "silent" }),
      service: "worker",
      fetch,
    });
    obs.beginJob(JOB, { workspaceId: WORKSPACE, job: "lesson.generate", lessonId: LESSON });
    const b = { jobId: JOB, job: "lesson.generate", attempt: 0 };
    obs.captureLogLine(b, slot(), "picture outcome");
    obs.captureLogLine(
      b,
      slot({ pictureKind: "portrait", frameCut: undefined, portraitCut: true, attempts: 1 }),
      "picture outcome",
    );
    obs.captureLogLine(
      b,
      slot({ outcome: "placed", via: "fetched", sourceKind: "commons", attempts: 0 }),
      "picture outcome",
    );
    obs.captureLogLine(
      b,
      slot({ outcome: "empty", via: "none", sourceKind: "none", reason: "declined", attempts: 0 }),
      "picture outcome",
    );
    obs.captureLogLine(
      b,
      { ev: "picture-outcome", outcome: "failed", reason: "error", sourceKind: "none" },
      "picture failed",
    );
    obs.captureLessonSummary(summary);
    await obs.flush();
    const roll = sent.flatMap((s) => s.events).find((e) => e.event === "gen_lesson_pictures");
    expect(roll?.properties).toMatchObject({
      lessonId: LESSON,
      outcome: "success",
      planner: "writer",
      lessonSubject: "science",
      keyStage: "ks2",
      pictures: 5,
      picturesPlaced: 3,
      picturesEmpty: 1,
      picturesFailed: 1,
      fromGenerated: 2,
      fromCommons: 1,
      generations: 3,
      retries: 1,
      judgeRefusals: 4,
      framesMeasured: 4,
      framesCut: 3,
      portraitsCut: 1,
    });
    expect(roll?.properties.pictureCostUsd).toBeCloseTo(0.32, 6);
    expect(roll?.properties).not.toHaveProperty("droppedProps");
    await obs.shutdown();
  });
});

test("slots the director routed away are counted apart, not as empty pictures", async () => {
  const { fetch, sent } = recordingFetch();
  const obs = createObservability({
    apiKey: "phc_test",
    modelIds: MODELS,
    logger: pino({ level: "silent" }),
    service: "worker",
    fetch,
  });
  obs.beginJob(JOB, { workspaceId: WORKSPACE, job: "lesson.generate", lessonId: LESSON });
  const b = { jobId: JOB, job: "lesson.generate", attempt: 0 };
  for (const outcome of ["none", "drawer", "none"])
    obs.captureLogLine(b, { ev: "picture-outcome", outcome, reason: "director-none" }, "x");
  obs.captureLessonSummary(summary);
  await obs.flush();
  const roll = sent.flatMap((s) => s.events).find((e) => e.event === "gen_lesson_pictures");
  expect(roll?.properties).toMatchObject({ pictures: 0, notWanted: 2, toDrawer: 1 });
  await obs.shutdown();
});
