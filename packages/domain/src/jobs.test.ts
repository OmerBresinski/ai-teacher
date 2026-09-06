import { describe, expect, test } from "bun:test";
import { type JobId, LessonId, newId, type WorkspaceId } from "./ids";
import {
  AiPingPayloadSchema,
  isTerminalJobEvent,
  JOB_TERMINAL_EVENT_TYPES,
  type JobEvent,
  JobEventSchema,
  JobEventType,
  JobName,
  JobNameSchema,
  JobPayloadSchemas,
  type JobPayloads,
  type PingPayload,
  PingPayloadSchema,
} from "./jobs";

const jobId = newId<JobId>();
const workspaceId = newId<WorkspaceId>();
const at = new Date().toISOString();

describe("JobName", () => {
  test("const object and schema agree", () => {
    expect(JobName.ping).toBe("ping");
    expect(JobName.aiPing).toBe("ai.ping");
    expect(JobName.lessonPlan).toBe("lesson.plan");
    expect(JobNameSchema.options).toEqual(Object.values(JobName));
    expect(JobNameSchema.parse("ping")).toBe("ping");
    expect(JobNameSchema.safeParse("nope").success).toBe(false);
  });

  test("every job name has a payload schema", () => {
    for (const name of JobNameSchema.options) {
      expect(JobPayloadSchemas[name]).toBeDefined();
    }
    expect(Object.keys(JobPayloadSchemas).sort()).toEqual([...JobNameSchema.options].sort());
  });
});

describe("JobPayloadSchemas.ping", () => {
  test("accepts a message and applies the steps default", () => {
    const parsed: JobPayloads["ping"] = JobPayloadSchemas.ping.parse({ message: "hello" });
    expect(parsed).toEqual({ message: "hello", steps: 5 });
    const explicit: PingPayload = PingPayloadSchema.parse({
      message: "hi",
      steps: 10,
      failAt: 3,
    });
    expect(explicit).toEqual({ message: "hi", steps: 10, failAt: 3 });
  });

  test.each([
    ["missing message", {}],
    ["empty message", { message: "" }],
    ["non-integer steps", { message: "x", steps: 1.5 }],
    ["zero steps", { message: "x", steps: 0 }],
    ["too many steps", { message: "x", steps: 101 }],
    ["negative failAt", { message: "x", failAt: -1 }],
    ["unknown field", { message: "x", extra: true }],
  ])("rejects %s", (_label, input) => {
    expect(PingPayloadSchema.safeParse(input).success).toBe(false);
  });
});

describe("JobPayloadSchemas.ai.ping", () => {
  test("applies the safe smoke defaults and rejects unknown fields", () => {
    expect(AiPingPayloadSchema.parse({})).toEqual({
      class: "small",
      prompt: "Reply with the single word: pong.",
    });
    expect(AiPingPayloadSchema.safeParse({ class: "huge" }).success).toBe(false);
    expect(AiPingPayloadSchema.safeParse({ extra: true }).success).toBe(false);
  });
});

describe("JobPayloadSchemas.lesson.plan", () => {
  const lessonId = "0192f7a0-0000-7000-8000-000000000042";

  test("accepts a UUID lessonId and nothing else", () => {
    const parsed = JobPayloadSchemas["lesson.plan"].parse({ lessonId });
    expect(parsed).toEqual({ lessonId: LessonId.parse(lessonId) });
  });

  test("rejects a non-UUID lessonId (LessonId brand)", () => {
    expect(() => JobPayloadSchemas["lesson.plan"].parse({ lessonId: "not-a-uuid" })).toThrow();
  });

  test("rejects unknown fields (strict)", () => {
    expect(() => JobPayloadSchemas["lesson.plan"].parse({ lessonId, extra: 1 })).toThrow();
  });

  test("rejects a missing lessonId", () => {
    expect(JobPayloadSchemas["lesson.plan"].safeParse({}).success).toBe(false);
  });
});

describe("JobEventSchema", () => {
  const base = { jobId, workspaceId, at };

  test("parses a progress event with percent 50", () => {
    const event = JobEventSchema.parse({ type: "progress", ...base, progress: { percent: 50 } });
    expect(event.type).toBe("progress");
    if (event.type === "progress") {
      expect(event.progress.percent).toBe(50);
      expect(event.progress.message).toBeUndefined();
    }
  });

  test("parses every variant", () => {
    const events: JobEvent[] = [
      { type: "queued", ...base },
      { type: "started", ...base },
      { type: "progress", ...base, progress: { percent: 12.5, message: "step 1/8" } },
      { type: "progress", ...base, progress: {} },
      { type: "completed", ...base },
      { type: "failed", ...base, error: { message: "boom", retryable: true } },
      { type: "cancelled", ...base },
    ];
    for (const event of events) {
      expect(JobEventSchema.parse(event)).toEqual(event);
    }
  });

  test('rejects type: "done"', () => {
    expect(JobEventSchema.safeParse({ type: "done", ...base }).success).toBe(false);
  });

  test("rejects unknown fields on every variant (strict)", () => {
    expect(JobEventSchema.safeParse({ type: "queued", ...base, extra: 1 }).success).toBe(false);
    expect(
      JobEventSchema.safeParse({ type: "progress", ...base, progress: { percent: 1, eta: 3 } })
        .success,
    ).toBe(false);
    expect(
      JobEventSchema.safeParse({
        type: "failed",
        ...base,
        error: { message: "x", retryable: false, code: "E" },
      }).success,
    ).toBe(false);
  });

  test.each([
    ["not ISO", "yesterday"],
    ["date only", "2026-09-04"],
    ["with offset", "2026-09-04T00:00:00+01:00"],
    ["epoch number", Date.now()],
  ])("rejects a bad `at` (%s)", (_label, badAt) => {
    expect(JobEventSchema.safeParse({ type: "started", ...base, at: badAt }).success).toBe(false);
  });

  test("rejects missing or malformed ids", () => {
    expect(JobEventSchema.safeParse({ type: "started", workspaceId, at }).success).toBe(false);
    expect(
      JobEventSchema.safeParse({ type: "started", jobId: "job-1", workspaceId, at }).success,
    ).toBe(false);
  });

  test("rejects progress percent outside 0–100 and failed without retryable", () => {
    expect(
      JobEventSchema.safeParse({ type: "progress", ...base, progress: { percent: 101 } }).success,
    ).toBe(false);
    expect(
      JobEventSchema.safeParse({ type: "progress", ...base, progress: { percent: -1 } }).success,
    ).toBe(false);
    expect(
      JobEventSchema.safeParse({ type: "failed", ...base, error: { message: "x" } }).success,
    ).toBe(false);
  });
});

describe("JOB_TERMINAL_EVENT_TYPES", () => {
  test("is a subset of JobEventType and matches the discriminated union", () => {
    const unionTypes = JobEventSchema.options.map((option) => option.shape.type.value);
    expect([...unionTypes].sort()).toEqual([...JobEventType.options].sort());
    for (const terminal of JOB_TERMINAL_EVENT_TYPES) {
      expect(unionTypes).toContain(terminal);
    }
    expect(JOB_TERMINAL_EVENT_TYPES).toEqual(["completed", "failed", "cancelled"]);
  });

  test("isTerminalJobEvent narrows correctly", () => {
    const base = { jobId, workspaceId, at };
    expect(isTerminalJobEvent({ type: "completed", ...base })).toBe(true);
    expect(isTerminalJobEvent({ type: "cancelled", ...base })).toBe(true);
    expect(
      isTerminalJobEvent({ type: "failed", ...base, error: { message: "x", retryable: false } }),
    ).toBe(true);
    expect(isTerminalJobEvent({ type: "queued", ...base })).toBe(false);
    expect(isTerminalJobEvent({ type: "started", ...base })).toBe(false);
    expect(isTerminalJobEvent({ type: "progress", ...base, progress: {} })).toBe(false);
  });
});
