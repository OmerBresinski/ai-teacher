/**
 * Integration: `POST /__test/seed-library` against TEST_DATABASE_URL through the header shim. The
 * guard and validation rows are in `test-routes.test.ts`.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { newId, type WorkspaceId } from "@tj/domain";
import type { Series } from "@tj/domain/documents";
import { lesson as lessonFixture } from "@tj/domain/documents/fixtures";
import { createApp } from "../app";
import { CaptureMailSender } from "../mail";
import { silentLogger, TEST_ENV } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";
import type { toSummaryJson } from "./documents";

const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping /__test/seed-library integration tests: ${t.reason}`);

type SummaryJson = ReturnType<typeof toSummaryJson>;

describeDb("POST /__test/seed-library against Postgres", () => {
  if (!t.ok) return;
  const { unsafeDb, close } = t.db;
  afterAll(() => close());

  const app = createApp({
    env: { ...TEST_ENV, ENABLE_TEST_ROUTES: "1" },
    db: t.db,
    logger: silentLogger,
    testMail: new CaptureMailSender(),
  });
  let wsA: WorkspaceId;
  let wsB: WorkspaceId;

  beforeEach(async () => {
    wsA = newId<WorkspaceId>();
    wsB = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsA, workspaceName: "A" });
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsB, workspaceName: "B" });
  });

  const send = (ws: WorkspaceId, method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        [WORKSPACE_HEADER]: ws,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  function fixtures() {
    const first = {
      ...lessonFixture(),
      id: "first",
      title: "First",
      updatedAt: "2026-08-01T10:00:00.000Z",
    };
    const second = {
      ...lessonFixture(),
      id: "second",
      title: "Second",
      updatedAt: "2026-08-20T10:00:00.000Z",
    };
    const unit: Series = {
      id: "unit",
      title: "Unit",
      lessonIds: ["second", "first"],
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-21T10:00:00.000Z",
    };
    return [
      { key: "first", kind: "lesson", body: first },
      { key: "second", kind: "lesson", body: second },
      { key: "unit", kind: "series", body: unit },
    ];
  }

  test("inserts into the caller's Workspace only and answers the key → id map", async () => {
    const res = await send(wsA, "POST", "/__test/seed-library", { documents: fixtures() });
    expect(res.status).toBe(201);
    const { ids } = (await res.json()) as { ids: Record<string, string> };
    expect(Object.keys(ids)).toEqual(["first", "second", "unit"]);
    const id = (key: string) => ids[key] ?? "unresolved";

    const list = await send(wsA, "GET", "/documents?kind=lesson");
    const { items } = (await list.json()) as { items: SummaryJson[] };
    // Dated from the fixture bodies: the later edit sorts first.
    expect(items.map((item) => item.title)).toEqual(["Second", "First"]);
    expect(items.map((item) => item.id)).toEqual([id("second"), id("first")]);

    const series = await send(wsA, "GET", `/documents/${id("unit")}/lessons`);
    const detail = (await series.json()) as { lessons: SummaryJson[] };
    expect(detail.lessons.map((item) => item.id)).toEqual([id("second"), id("first")]);

    const other = await send(wsB, "GET", "/documents?kind=lesson");
    expect(((await other.json()) as { items: SummaryJson[] }).items).toEqual([]);
  });

  test("a document can be seeded under a generating lock", async () => {
    const jobId = "01a06a15-1849-7000-ac6a-c07e27fe308b";
    const [first] = fixtures();
    if (!first) throw new Error("fixture missing");
    // Dated now: `GET /documents/:id` releases a never-queued lock older than ten minutes.
    const body = { ...first.body, updatedAt: new Date().toISOString() };
    const res = await send(wsA, "POST", "/__test/seed-library", {
      documents: [{ ...first, body, generatingJobId: jobId }],
    });
    expect(res.status).toBe(201);
    const { ids } = (await res.json()) as { ids: Record<string, string> };
    const read = await send(wsA, "GET", `/documents/${ids.first ?? ""}`);
    const { document } = (await read.json()) as { document: SummaryJson };
    expect(document.generatingJobId).toBe(jobId);
  });

  test("422 with the parser's message when a body is not a document of its kind", async () => {
    const res = await send(wsA, "POST", "/__test/seed-library", {
      documents: [
        {
          key: "bad",
          kind: "lesson",
          body: {
            id: "bad",
            title: "Bad",
            createdAt: "2026-08-01T10:00:00.000Z",
            updatedAt: "2026-08-01T10:00:00.000Z",
          },
        },
      ],
    });
    expect(res.status).toBe(422);
  });
});
