/**
 * Unit rows for `POST /lessons` that need no database: guards, validation, the 503 without a job
 * runtime, `lessonFromBrief` defaults, and cancel-on-insert-failure with a fake `JobsContext`.
 */
import { describe, expect, mock, test } from "bun:test";
import { type JobId, type LessonId, newId, type WorkspaceId } from "@tj/domain";
import { GUARD_MESSAGE } from "@tj/domain/documents";
import type { JobsContext } from "@tj/jobs";
import { createApp } from "../app";
import type { ErrorEnvelope } from "../errors";
import { createEventsRuntime } from "../events/runtime";
import { fakeSql, silentLogger, TEST_ENV, TEST_ENV_NO_SHIM, testApp } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";
import { lessonFromBrief } from "./lessons";

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
      { brief: { topic: "Help Amir Khan" } },
      ["brief"],
    ],
    ["sourceIds (Sources are F03; strict)", { ...validBrief, sourceIds: [] }, ["(root)"]],
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
      brief: { topic: "  Fractions of amounts ", durationMin: 60 },
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

describe("POST /lessons when the insert fails", () => {
  test("cancels the queued job and answers a 5xx envelope", async () => {
    // pg-boss honours `options.id`; the fake must echo it or `enqueue` refuses the mismatch.
    const send = mock(async (_name: string, _data: unknown, opts: { id: string }) => opts.id);
    const cancelled: string[] = [];
    const boss = {
      send,
      findJobs: mock(async (_name: string, { id }: { id: string }) => [
        { id, state: "created", data: { workspaceId: ws }, startedOn: null },
      ]),
      cancel: mock(async (_name: string, id: string) => {
        cancelled.push(id);
      }),
    };
    // The jobs context's db accepts the `queued` job-event insert; the route's `unsafeDb` throws
    // on first touch, so the failure is the document insert — after the job is queued.
    const jobsDb = {
      insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
    };
    let touched = 0;
    const brokenDb = new Proxy(
      {},
      {
        get(_t, prop) {
          touched++;
          throw new Error(`db.${String(prop)} unavailable`);
        },
      },
    );
    const jobs = { boss, db: jobsDb, sql: (async () => []) as never } as unknown as JobsContext;
    const runtime = createEventsRuntime({ jobs, logger: silentLogger });
    const app = createApp({
      env: TEST_ENV,
      db: { sql: fakeSql(true).sql, unsafeDb: brokenDb as never },
      logger: silentLogger,
      jobs,
      events: runtime,
    });

    const res = await app.request("/lessons", post(validBrief));

    expect(res.status).toBe(500);
    expect((await errorBody(res)).error.code).toBe("internal_error");
    expect(send).toHaveBeenCalledTimes(1);
    expect(touched).toBeGreaterThan(0);
    const queuedId = send.mock.calls[0]?.[2].id;
    expect(typeof queuedId).toBe("string");
    expect(cancelled).toEqual([queuedId as string]);
  });
});
