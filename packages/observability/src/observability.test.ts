import { describe, expect, test } from "bun:test";
import pino from "pino";
import {
  type AiGeneration,
  createObservability,
  distinctIdFor,
  type LessonSummary,
  type ObservabilityFetch,
  SYSTEM_DISTINCT_ID,
} from "./observability";
import { UNRECOGNISED_MESSAGE } from "./scrub";

const PROMPT = "PROMPT-SENTINEL write a lesson about volcanoes";
const OUTPUT = "OUTPUT-SENTINEL Volcanoes erupt when magma rises";
const WORKSPACE = "0d9f3c1e-5b7a-4c2d-9e8f-1a2b3c4d5e6f";
const JOB = "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const LESSON = "lesson_1";

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
    expect(list[0]?.value).toBe(UNRECOGNISED_MESSAGE);
    expect(list[0]?.stacktrace?.frames?.length ?? 0).toBeGreaterThan(0);
    expect(exception?.distinct_id).toBe(distinctIdFor(WORKSPACE));
    expect(sent.map((s) => s.text).join("\n")).not.toContain("OUTPUT-SENTINEL");
    await obs.shutdown();
  });

  test("our own message is kept, with a URL's token and a key scrubbed", async () => {
    const { fetch, sent } = recordingFetch();
    const obs = createObservability({
      apiKey: "phc_test",
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
    expect(value).toContain("https://bucket.example.com/img.png");
    expect(value).toContain("[redacted-key]");
    const all = sent.map((s) => s.text).join("\n");
    expect(all).not.toContain("X-Amz-Signature");
    expect(all).not.toContain("sk-proj-AbCdEf1234567890");
    await obs.shutdown();
  });

  test("a failing transport never throws and is logged once", async () => {
    const { logger, lines } = captureLogger();
    const { fetch } = recordingFetch(async () => {
      throw new Error("ECONNREFUSED eu.i.posthog.com");
    });
    const obs = createObservability({ apiKey: "phc_test", logger, service: "worker", fetch });
    obs.captureAiGeneration(call);
    await obs.flush();
    obs.captureAiGeneration(call);
    await obs.flush();
    await obs.shutdown();
    const warnings = lines.filter((l) => l.msg === "posthog send failed; events dropped");
    expect(warnings).toHaveLength(1);
  });

  test("a hanging transport is cut off by the flush timeout", async () => {
    const { logger, lines } = captureLogger();
    const { fetch } = recordingFetch(() => new Promise<Response>(() => {}));
    const obs = createObservability({
      apiKey: "phc_test",
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
  });
});

describe("gen_* events from log lines", () => {
  test("writer, pipeline and message lines become gen_* events with metadata only", async () => {
    const { fetch, sent } = recordingFetch();
    const obs = createObservability({
      apiKey: "phc_test",
      logger: pino({ level: "silent" }),
      service: "worker",
      fetch,
    });
    obs.beginJob(JOB, { workspaceId: WORKSPACE, job: "lesson.generate", lessonId: LESSON });
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
        byField: { answer: 2, stem: 1 },
      },
      "facts verified",
    );
    obs.captureLogLine(
      b,
      { stage: "illustrate", spentUsd: 0.4, capUsd: 0.5 },
      "illustrate budget stop",
    );
    obs.captureLogLine(
      b,
      {
        ev: "picture-outcome",
        via: "stock",
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
      byField_answer: 2,
      byField_stem: 1,
    });
    expect(byName("gen_budget_stop")).toMatchObject({
      stage: "illustrate",
      spentUsd: 0.4,
      capUsd: 0.5,
    });
    // A sentence is not an identifier: the free-text reason is dropped, the codes stay.
    expect(byName("gen_picture_outcome")).toMatchObject({ via: "stock", attempts: 2 });
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

describe("distinctIdFor", () => {
  test("is a stable hash, never the Workspace id", () => {
    expect(distinctIdFor(WORKSPACE)).toBe(distinctIdFor(WORKSPACE));
    expect(distinctIdFor(WORKSPACE)).toMatch(/^ws_[0-9a-f]{32}$/);
    expect(distinctIdFor(WORKSPACE)).not.toContain(WORKSPACE.slice(0, 8));
    expect(distinctIdFor(undefined)).toBe(SYSTEM_DISTINCT_ID);
  });
});
