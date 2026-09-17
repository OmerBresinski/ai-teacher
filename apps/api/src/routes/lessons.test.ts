/**
 * Unit rows for `POST /lessons`, `/plan` and `/generate` that need no database: guards,
 * validation, the 503 without a job runtime, `lessonFromBrief` defaults, the row and payload
 * `createLessonAndEnqueue` writes, and cancel-on-insert-failure with a fake `JobsContext`.
 */
import { describe, expect, mock, test } from "bun:test";
import type { WorkspaceDb } from "@tj/db";
import { type LessonId, newId, type WorkspaceId } from "@tj/domain";
import type { JobsContext } from "@tj/jobs";
import { createApp } from "../app";
import type { ErrorEnvelope } from "../errors";
import { createEventsRuntime } from "../events/runtime";
import { fakeSql, silentLogger, TEST_ENV_NO_SHIM, testApp } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";
import { createLessonAndEnqueue, lessonFromBrief } from "./lessons";

const ws = newId<WorkspaceId>();

const post = (body: unknown, headers: Record<string, string> = { [WORKSPACE_HEADER]: ws }) => ({
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify(body),
});
const errorBody = (res: Response) => res.json() as Promise<ErrorEnvelope>;
const validBrief = { brief: { topic: "Fractions of amounts" }, yearGroup: "Year 5" };

describe("POST /lessons guards", () => {
  test("401 without a session or shim", async () => {
    const app = createApp({ env: TEST_ENV_NO_SHIM, db: fakeSql(true), logger: silentLogger });
    const res = await app.request("/lessons", post(validBrief, {}));
    expect(res.status).toBe(401);
  });

  test("403 for a cross-site request", async () => {
    const res = await testApp().request(
      "/lessons",
      post(validBrief, {
        [WORKSPACE_HEADER]: ws,
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /lessons validation", () => {
  test.each([
    ["an empty body", {}, ["brief"]],
    [
      "a learner name in the topic (Identifier guard)",
      { brief: { topic: "Help a pupil called Amir" } },
      ["brief"],
    ],
    [
      "four sourceIds (ADR 0027 §5: at most three)",
      { ...validBrief, sourceIds: Array(4).fill("0192b6e0-0000-7000-8000-000000000001") },
      ["sourceIds"],
    ],
    ["a non-uuid sourceId", { ...validBrief, sourceIds: ["nope"] }, ["sourceIds"]],
    ["a bad ageBand", { ...validBrief, ageBand: "ks9" }, ["ageBand"]],
    ["a duration under 5", { brief: { topic: "x", durationMin: 1 } }, ["brief"]],
  ])("400 validation_failed for %s", async (_label, body, fields) => {
    const res = await testApp().request("/lessons", post(body));
    expect(res.status).toBe(400);
    expect((await errorBody(res)).error).toMatchObject({ code: "validation_failed", fields });
  });

  test("400 without a JSON content type", async () => {
    const res = await testApp().request("/lessons", {
      method: "POST",
      headers: { [WORKSPACE_HEADER]: ws },
      body: JSON.stringify(validBrief),
    });
    expect(res.status).toBe(400);
  });

  test("503 when no job runtime is configured, before any insert (unreachableDb never touched)", async () => {
    const res = await testApp().request("/lessons", post(validBrief));
    expect(res.status).toBe(503);
    expect((await errorBody(res)).error).toMatchObject({
      code: "service_unavailable",
      retryable: true,
    });
  });
});

const CASCADE_PATH = `/lessons/${newId<LessonId>()}/cascade`;
const REGENERATE_PATH = `/lessons/${newId<LessonId>()}/regenerate`;

describe("POST /lessons/:id/cascade and /regenerate guards and validation (ADR 0025 §18)", () => {
  test("401 without a session or shim; 403 cross-site", async () => {
    const noShim = createApp({ env: TEST_ENV_NO_SHIM, db: fakeSql(true), logger: silentLogger });
    expect((await noShim.request(CASCADE_PATH, post({ changedFactIds: ["o1"] }, {}))).status).toBe(
      401,
    );
    expect(
      (
        await testApp().request(
          REGENERATE_PATH,
          post(
            { targets: [{ slideId: "s1" }] },
            {
              [WORKSPACE_HEADER]: ws,
              origin: "https://evil.example",
              "sec-fetch-site": "cross-site",
            },
          ),
        )
      ).status,
    ).toBe(403);
  });

  test.each([
    ["cascade: no changed facts", CASCADE_PATH, { changedFactIds: [] }, ["changedFactIds"]],
    [
      "cascade: lessonId in the body (strict)",
      CASCADE_PATH,
      { changedFactIds: ["o1"], lessonId: "x" },
      ["(root)"],
    ],
    ["regenerate: no targets", REGENERATE_PATH, { targets: [] }, ["targets"]],
    [
      "regenerate: a target with neither slideId nor blockId",
      REGENERATE_PATH,
      { targets: [{ elementId: "e" }] },
      ["targets"],
    ],
    [
      "regenerate: an instruction over 500 chars",
      REGENERATE_PATH,
      { targets: [{ slideId: "s" }], instruction: "x".repeat(501) },
      ["instruction"],
    ],
  ])("400 validation_failed for %s", async (_label, path, body, fields) => {
    const res = await testApp().request(path, post(body));
    expect(res.status).toBe(400);
    expect((await errorBody(res)).error).toMatchObject({ code: "validation_failed", fields });
  });

  test("400 for a non-UUID lesson id", async () => {
    const res = await testApp().request(
      "/lessons/not-a-uuid/cascade",
      post({ changedFactIds: ["o1"] }),
    );
    expect(res.status).toBe(400);
  });

  test("503 when no job runtime is configured, before any read", async () => {
    const res = await testApp().request(CASCADE_PATH, post({ changedFactIds: ["o1"] }));
    expect(res.status).toBe(503);
  });
});

const PLAN_PATH = `/lessons/${newId<LessonId>()}/plan`;
const GENERATE_PATH = `/lessons/${newId<LessonId>()}/generate`;
const validPlan = { expectedRevision: 1, brief: { topic: "Fractions of amounts" } };
const validGenerate = { expectedRevision: 1, objectives: [{ id: "o1", text: "Find a half" }] };

describe("POST /lessons skipPlanning and requestId validation (ADR 0029)", () => {
  test.each([
    ["a non-boolean skipPlanning", { ...validBrief, skipPlanning: "yes" }, ["skipPlanning"]],
    ["a non-uuid requestId", { ...validBrief, requestId: "abc" }, ["requestId"]],
    ["a slide count outside 6/8/10/12", { brief: { topic: "x", slideCount: 7 } }, ["brief"]],
    ["an unknown level", { brief: { topic: "x", level: "expert" } }, ["brief"]],
  ])("400 validation_failed for %s", async (_label, body, fields) => {
    const res = await testApp().request("/lessons", post(body));
    expect(res.status).toBe(400);
    expect((await errorBody(res)).error).toMatchObject({ code: "validation_failed", fields });
  });
});

describe("POST /lessons/:id/plan and /generate guards and validation (ADR 0029)", () => {
  test.each([
    ["plan", PLAN_PATH, validPlan],
    ["generate", GENERATE_PATH, validGenerate],
  ])("%s: 401 without a session or shim; 403 cross-site", async (_label, path, body) => {
    const noShim = createApp({ env: TEST_ENV_NO_SHIM, db: fakeSql(true), logger: silentLogger });
    expect((await noShim.request(path, post(body, {}))).status).toBe(401);
    const crossSite = await testApp().request(
      path,
      post(body, {
        [WORKSPACE_HEADER]: ws,
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      }),
    );
    expect(crossSite.status).toBe(403);
  });

  test.each([
    ["plan: no expectedRevision", PLAN_PATH, { brief: { topic: "x" } }, ["expectedRevision"]],
    [
      "plan: a negative revision",
      PLAN_PATH,
      { ...validPlan, expectedRevision: -1 },
      ["expectedRevision"],
    ],
    ["plan: no brief", PLAN_PATH, { expectedRevision: 1 }, ["brief"]],
    [
      "plan: a learner name in the topic",
      PLAN_PATH,
      { expectedRevision: 1, brief: { topic: "Help a pupil called Amir" } },
      ["brief"],
    ],
    [
      "plan: clarifying answers are not re-plannable",
      PLAN_PATH,
      { expectedRevision: 1, brief: { topic: "x", answers: { q: "a" } } },
      ["brief"],
    ],
    [
      "plan: four sourceIds",
      PLAN_PATH,
      { ...validPlan, sourceIds: Array(4).fill("0192b6e0-0000-7000-8000-000000000001") },
      ["sourceIds"],
    ],
    ["plan: lessonId in the body (strict)", PLAN_PATH, { ...validPlan, lessonId: "x" }, ["(root)"]],
    [
      "generate: five objectives",
      GENERATE_PATH,
      { expectedRevision: 1, objectives: Array(5).fill({ text: "Find a half" }) },
      ["objectives"],
    ],
    [
      "generate: a blank objective",
      GENERATE_PATH,
      { expectedRevision: 1, objectives: [{ text: "   " }] },
      ["objectives"],
    ],
    [
      "generate: an identifier in an objective",
      GENERATE_PATH,
      { expectedRevision: 1, objectives: [{ text: "Email amir@example.com the answers" }] },
      ["objectives"],
    ],
    [
      "generate: an objective id that is not a fact id",
      GENERATE_PATH,
      { expectedRevision: 1, objectives: [{ id: "Objective 1", text: "Find a half" }] },
      ["objectives"],
    ],
    [
      "generate: a slide count of 7",
      GENERATE_PATH,
      { ...validGenerate, slideCount: 7 },
      ["slideCount"],
    ],
    ["generate: no objectives field", GENERATE_PATH, { expectedRevision: 1 }, ["objectives"]],
  ])("400 validation_failed for %s", async (_label, path, body, fields) => {
    const res = await testApp().request(path, post(body));
    expect(res.status).toBe(400);
    expect((await errorBody(res)).error).toMatchObject({ code: "validation_failed", fields });
  });

  test("400 for a non-UUID lesson id", async () => {
    expect((await testApp().request("/lessons/nope/plan", post(validPlan))).status).toBe(400);
    expect((await testApp().request("/lessons/nope/generate", post(validGenerate))).status).toBe(
      400,
    );
  });

  test("generate with no objectives is 422 before anything is read", async () => {
    const res = await testApp().request(
      GENERATE_PATH,
      post({ expectedRevision: 1, objectives: [] }),
    );
    expect(res.status).toBe(422);
    expect((await errorBody(res)).error).toMatchObject({
      code: "unprocessable",
      message: "Keep at least one objective.",
    });
  });

  test("503 when no job runtime is configured, before any read", async () => {
    expect((await testApp().request(PLAN_PATH, post(validPlan))).status).toBe(503);
    expect((await testApp().request(GENERATE_PATH, post(validGenerate))).status).toBe(503);
  });
});

describe("lessonFromBrief", () => {
  const id = newId<LessonId>();
  const now = new Date("2026-09-06T10:00:00.000Z");

  test("derives the age band and duration from the year group and titles from the topic", () => {
    const lesson = lessonFromBrief(
      { brief: { topic: "  Fractions of amounts " }, yearGroup: "Year 5" },
      id,
      now,
    );
    expect(lesson).toEqual({
      version: 1,
      id,
      title: "Fractions of amounts",
      themeId: "chalk",
      slides: [],
      createdAt: "2026-09-06T10:00:00.000Z",
      updatedAt: "2026-09-06T10:00:00.000Z",
      fitVersion: 0,
      yearGroup: "Year 5",
      ageBand: "ks2",
      language: "en-GB",
      brief: { topic: "  Fractions of amounts ", durationMin: 60, slideCount: 10 },
    });
  });

  test("keeps explicit values, leaves ageBand unset when the year group is unknown", () => {
    const lesson = lessonFromBrief(
      {
        brief: { topic: "Phonics", durationMin: 45, classContext: { sizeBand: "25to30" } },
        subject: "English",
        themeId: "playground",
        language: "cy",
        readingLevel: "Year 1",
      },
      id,
      now,
    );
    expect(lesson.ageBand).toBeUndefined();
    expect(lesson.brief?.durationMin).toBe(45);
    expect(lesson.brief?.classContext).toEqual({ sizeBand: "25to30" });
    expect(lesson).toMatchObject({ subject: "English", themeId: "playground", language: "cy" });
  });

  test("an explicit ageBand wins over the year group and sets the duration", () => {
    const lesson = lessonFromBrief(
      { brief: { topic: "x" }, yearGroup: "Year 5", ageBand: "eyfs" },
      id,
      now,
    );
    expect(lesson.ageBand).toBe("eyfs");
    expect(lesson.brief?.durationMin).toBe(30);
  });

  test("truncates a long topic to the title limit", () => {
    const lesson = lessonFromBrief({ brief: { topic: "a".repeat(200) } }, id, now);
    expect(lesson.title).toHaveLength(80);
    expect(lesson.brief?.topic).toHaveLength(200);
  });
});

describe("createLessonAndEnqueue when the enqueue fails", () => {
  const lessonId = newId<LessonId>();
  const lesson = lessonFromBrief(validBrief, lessonId, new Date());

  function fakes(sendResult: "throws" | "null", sourceIds: string[] = []) {
    const created: unknown[] = [];
    const deleted: string[] = [];
    /** Every `UPDATE sources … SET` value seen: the claim (`lessonId` set) then the release (`null`). */
    const sourceUpdates: unknown[] = [];
    const scoped = {
      workspaceId: ws,
      insert: () => ({
        values: (row: unknown) => ({
          returning: async () => {
            created.push(row);
            return [row];
          },
        }),
      }),
      update: () => ({
        set: (values: { lessonId: string | null }) => ({
          returning: async () => {
            sourceUpdates.push(values);
            return sourceIds.map((id) => ({
              id,
              kind: "file",
              name: `${id}.pdf`,
              storageKey: `${ws}/sources/${id}/original.pdf`,
              pages: 1,
              lessonId: values.lessonId,
            }));
          },
        }),
      }),
      delete: () => ({
        returning: async () => {
          deleted.push(lessonId);
          return [{ id: lessonId }];
        },
      }),
      tx: (fn: (scoped: WorkspaceDb) => Promise<unknown>) => fn(scoped),
    } as unknown as WorkspaceDb;
    const send = mock(async (_name: string, _data: unknown, _opts: { id: string }) => {
      if (sendResult === "throws") throw new Error("pg-boss down");
      return null;
    });
    const jobs = {
      boss: { send, cancel: mock(async () => {}) },
      db: {},
      sql: {},
    } as unknown as JobsContext;
    const runtime = createEventsRuntime({ jobs, logger: silentLogger });
    return { ws: scoped, runtime, send, created, deleted, sourceUpdates };
  }

  test("removes the just-inserted row and rethrows when pg-boss is down", async () => {
    const f = fakes("throws");
    await expect(createLessonAndEnqueue(f.ws, f.runtime, lesson)).rejects.toThrow("pg-boss down");
    expect(f.created).toHaveLength(1);
    expect((f.created[0] as { generatingJobId: string }).generatingJobId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(f.deleted).toEqual([lessonId]);
  });

  test("removes the row and answers 409 when the send was deduplicated", async () => {
    const f = fakes("null");
    await expect(createLessonAndEnqueue(f.ws, f.runtime, lesson)).rejects.toMatchObject({
      status: 409,
    });
    expect(f.deleted).toEqual([lessonId]);
  });

  test("with sourceIds the claimed rows become lesson.sources, and a failed enqueue releases them (ADR 0027 §5)", async () => {
    const a = newId();
    const b = newId();
    const f = fakes("throws", [a, b]);
    await expect(createLessonAndEnqueue(f.ws, f.runtime, lesson, [a, b, a])).rejects.toThrow(
      "pg-boss down",
    );
    const body = (f.created[0] as { body: { sources?: unknown[] } }).body;
    expect(body.sources).toEqual([
      {
        id: a,
        kind: "file",
        name: `${a}.pdf`,
        storageKey: `${ws}/sources/${a}/original.pdf`,
        pages: 1,
      },
      {
        id: b,
        kind: "file",
        name: `${b}.pdf`,
        storageKey: `${ws}/sources/${b}/original.pdf`,
        pages: 1,
      },
    ]);
    expect(f.sourceUpdates.map((u) => (u as { lessonId: string | null }).lessonId)).toEqual([
      lessonId,
      null,
    ]);
    expect(f.deleted).toEqual([lessonId]);
  });

  test("a short claim is 422 and nothing is inserted", async () => {
    const a = newId();
    const f = fakes("null", [a]);
    await expect(
      createLessonAndEnqueue(f.ws, f.runtime, lesson, [a, newId()]),
    ).rejects.toMatchObject({ status: 422 });
    expect(f.created).toEqual([]);
    expect(f.send).not.toHaveBeenCalled();
  });

  test("the row carries plan revision 1 and the queued payload stops at planned", async () => {
    const f = fakes("throws");
    await createLessonAndEnqueue(f.ws, f.runtime, lesson).catch(() => undefined);
    const row = f.created[0] as {
      body: { plan?: unknown };
      generatingJobId: string;
      continueWhenPlanned: boolean;
      requestId: string | null;
    };
    expect(row.body.plan).toEqual({ revision: 1, state: "proposed", jobId: row.generatingJobId });
    expect(row.continueWhenPlanned).toBe(false);
    expect(row.requestId).toBeNull();
    const data = (f.send.mock.calls[0] as unknown as [string, { payload: unknown }])[1];
    expect(data.payload).toEqual({ lessonId, revision: 1, stopAfter: "planned" });
  });

  test("skipPlanning: confirmed up front, continue_when_planned set, no stopAfter", async () => {
    const f = fakes("throws");
    const requestId = newId();
    await createLessonAndEnqueue(f.ws, f.runtime, lesson, [], {
      skipPlanning: true,
      requestId,
    }).catch(() => undefined);
    const row = f.created[0] as {
      body: { plan?: unknown };
      generatingJobId: string;
      continueWhenPlanned: boolean;
      requestId: string | null;
    };
    expect(row.body.plan).toEqual({
      revision: 1,
      state: "confirmed",
      jobId: row.generatingJobId,
      confirmedAt: lesson.createdAt,
    });
    expect(row.continueWhenPlanned).toBe(true);
    expect(row.requestId).toBe(requestId);
    const data = (f.send.mock.calls[0] as unknown as [string, { payload: unknown }])[1];
    expect(data.payload).toEqual({ lessonId, revision: 1 });
  });

  test("enqueue is given the same job id the row was locked with", async () => {
    const f = fakes("throws");
    await createLessonAndEnqueue(f.ws, f.runtime, lesson).catch(() => undefined);
    const lockedWith = (f.created[0] as { generatingJobId: string }).generatingJobId;
    const sentWith = (f.send.mock.calls[0] as unknown as [string, unknown, { id: string }])[2].id;
    expect(sentWith).toBe(lockedWith);
  });
});
