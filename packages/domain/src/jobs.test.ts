import { describe, expect, test } from "bun:test";
import { type JobId, LessonId, newId, type WorkspaceId } from "./ids";
import {
  AiPingPayloadSchema,
  CASCADE_MAX_FACTS,
  isTerminalJobEvent,
  JOB_TERMINAL_EVENT_TYPES,
  JobCompletedEventSchema,
  type JobEvent,
  JobEventSchema,
  JobEventType,
  JobName,
  JobNameSchema,
  JobPayloadSchemas,
  type JobPayloads,
  JobProgressSchema,
  JobResultSchema,
  type PingPayload,
  PingPayloadSchema,
  ProposalSchema,
  REGENERATE_INSTRUCTION_MAX,
  REGENERATE_MAX_TARGETS,
} from "./jobs";

const jobId = newId<JobId>();
const workspaceId = newId<WorkspaceId>();
const at = new Date().toISOString();

describe("JobName", () => {
  test("const object and schema agree", () => {
    expect(JobName.ping).toBe("ping");
    expect(JobName.aiPing).toBe("ai.ping");
    expect(JobName.lessonPlan).toBe("lesson.plan");
    expect(JobName.lessonCascade).toBe("lesson.cascade");
    expect(JobName.lessonRegenerate).toBe("lesson.regenerate");
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

describe("JobPayloadSchemas.lesson.cascade", () => {
  const lessonId = "0192f7a0-0000-7000-8000-000000000042";

  test("needs at least one changed fact id and at most CASCADE_MAX_FACTS", () => {
    expect(() =>
      JobPayloadSchemas["lesson.cascade"].parse({ lessonId, changedFactIds: [] }),
    ).toThrow();
    expect(
      JobPayloadSchemas["lesson.cascade"].parse({ lessonId, changedFactIds: ["o1", "v2"] }),
    ).toEqual({ lessonId: LessonId.parse(lessonId), changedFactIds: ["o1", "v2"] });
    const tooMany = Array.from({ length: CASCADE_MAX_FACTS + 1 }, (_, i) => `o${i}`);
    expect(
      JobPayloadSchemas["lesson.cascade"].safeParse({ lessonId, changedFactIds: tooMany }).success,
    ).toBe(false);
  });

  test("rejects unknown fields and a non-UUID lessonId", () => {
    expect(
      JobPayloadSchemas["lesson.cascade"].safeParse({ lessonId, changedFactIds: ["o1"], x: 1 })
        .success,
    ).toBe(false);
    expect(
      JobPayloadSchemas["lesson.cascade"].safeParse({ lessonId: "nope", changedFactIds: ["o1"] })
        .success,
    ).toBe(false);
  });
});

describe("JobPayloadSchemas.lesson.regenerate", () => {
  const lessonId = "0192f7a0-0000-7000-8000-000000000042";

  test("accepts slide, element and block targets with an optional instruction", () => {
    const payload = {
      lessonId,
      targets: [{ slideId: "s1" }, { slideId: "s1", elementId: "e1" }, { blockId: "b1" }],
      instruction: "Make it simpler",
    };
    expect(JobPayloadSchemas["lesson.regenerate"].parse(payload)).toEqual({
      ...payload,
      lessonId: LessonId.parse(lessonId),
    });
  });

  test("every target names exactly one of slideId or blockId, and elementId needs its slideId", () => {
    const schema = JobPayloadSchemas["lesson.regenerate"];
    const result = schema.safeParse({ lessonId, targets: [{ elementId: "e1" }] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["targets", 0]);
    expect(schema.safeParse({ lessonId, targets: [{ slideId: "s", blockId: "b" }] }).success).toBe(
      false,
    );
    const dangling = schema.safeParse({ lessonId, targets: [{ blockId: "b", elementId: "e" }] });
    expect(dangling.success).toBe(false);
    expect(dangling.error?.issues[0]?.path).toEqual(["targets", 0, "elementId"]);
  });

  test("bounds: 1..REGENERATE_MAX_TARGETS targets, instruction ≤ REGENERATE_INSTRUCTION_MAX", () => {
    const schema = JobPayloadSchemas["lesson.regenerate"];
    expect(schema.safeParse({ lessonId, targets: [] }).success).toBe(false);
    const many = Array.from({ length: REGENERATE_MAX_TARGETS + 1 }, (_, i) => ({
      slideId: `s${i}`,
    }));
    expect(schema.safeParse({ lessonId, targets: many }).success).toBe(false);
    expect(
      schema.safeParse({
        lessonId,
        targets: [{ slideId: "s" }],
        instruction: "x".repeat(REGENERATE_INSTRUCTION_MAX + 1),
      }).success,
    ).toBe(false);
  });
});

describe("JobResultSchema (ADR 0025 §19)", () => {
  const base = { jobId, workspaceId, at };
  const provenance = {
    factRefs: ["o1"],
    promptVersion: "generate.v1",
    model: "m",
    at: "2026-09-06T10:00:00.000Z",
  };

  test("a completed event carries an optional result whose job discriminator narrows", () => {
    const event = JobCompletedEventSchema.parse({
      type: "completed",
      ...base,
      result: { job: "lesson.cascade", proposals: [], flagged: [] },
    });
    expect(event.result?.job).toBe("lesson.cascade");
    if (event.result?.job === "lesson.cascade") {
      expect(event.result.proposals).toEqual([]);
      expect(event.result.flagged).toEqual([]);
    }
    expect(JobEventSchema.parse({ type: "completed", ...base })).toEqual({
      type: "completed",
      ...base,
    });
  });

  test("a proposal carries a target, an element or a block, and its provenance", () => {
    const element = {
      id: "e1",
      type: "text",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      doc: { type: "doc" },
      style: { preset: "body" },
      authoredBy: "ai",
      generatedFrom: provenance,
    };
    const result = JobResultSchema.parse({
      job: "lesson.regenerate",
      proposals: [
        { target: { slideId: "s1", elementId: "e1" }, element, generatedFrom: provenance },
        {
          target: { blockId: "b1" },
          block: { id: "b1", type: "paragraph", doc: { type: "doc" } },
          generatedFrom: provenance,
        },
      ],
      flagged: [{ slideId: "s2", elementId: "e9" }],
    });
    expect(result.job).toBe("lesson.regenerate");
    expect(result.proposals).toHaveLength(2);
    expect(result.flagged).toEqual([{ slideId: "s2", elementId: "e9" }]);
  });

  test("a proposal carries exactly one payload, on the target's side", () => {
    const element = {
      id: "e1",
      type: "text",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      doc: { type: "doc" },
      style: { preset: "body" },
    };
    const block = { id: "b1", type: "paragraph", doc: { type: "doc" } };
    const proposal = (p: Record<string, unknown>) =>
      ProposalSchema.safeParse({ generatedFrom: provenance, ...p }).success;
    expect(proposal({ target: { slideId: "s1" } })).toBe(false);
    expect(proposal({ target: { slideId: "s1" }, element, block })).toBe(false);
    expect(proposal({ target: { slideId: "s1" }, block })).toBe(false);
    expect(proposal({ target: { blockId: "b1" }, element })).toBe(false);
    expect(proposal({ target: { slideId: "s1", elementId: "e1" }, element })).toBe(true);
    expect(proposal({ target: { blockId: "b1" }, block })).toBe(true);
  });

  test("rejects an unknown job, a lesson.plan result, and unknown fields", () => {
    expect(JobResultSchema.safeParse({ job: "lesson.plan" }).success).toBe(false);
    expect(
      JobResultSchema.safeParse({ job: "lesson.cascade", proposals: [], flagged: [], extra: 1 })
        .success,
    ).toBe(false);
    expect(
      JobEventSchema.safeParse({ type: "completed", ...base, result: { job: "nope" } }).success,
    ).toBe(false);
  });

  test("a progress event carries documentUpdatedAt as an ISO UTC time (ADR 0025 §7)", () => {
    const progress = { percent: 10, documentUpdatedAt: "2026-09-06T10:00:00.000Z" };
    expect(JobProgressSchema.parse(progress)).toEqual(progress);
    expect(
      JobProgressSchema.safeParse({ percent: 10, documentUpdatedAt: "2026-09-06" }).success,
    ).toBe(false);
    const event = JobEventSchema.parse({ type: "progress", ...base, progress });
    expect(event.type === "progress" && event.progress.documentUpdatedAt).toBe(
      "2026-09-06T10:00:00.000Z",
    );
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
