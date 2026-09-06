/**
 * Integration: `/documents/*` against TEST_DATABASE_URL (ADR 0014) through the header shim, one
 * fresh Workspace pair per test. Every acceptance row that touches data lives here; validation and
 * guard rows are in `documents.test.ts`.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDocument, forWorkspace, insertJobEvent } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { type JobId, newId, type WorkspaceId } from "@tj/domain";
import type { Lesson, Series } from "@tj/domain/documents";
import {
  lesson as lessonFixture,
  worksheet as worksheetFixture,
} from "@tj/domain/documents/fixtures";
import { createApp } from "../app";
import type { ErrorEnvelope } from "../errors";
import { silentLogger, TEST_ENV } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";
import type { toDocumentJson, toSummaryJson } from "./documents";

const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping /documents integration tests: ${t.reason}`);

type DocumentJson = ReturnType<typeof toDocumentJson>;
type SummaryJson = ReturnType<typeof toSummaryJson>;

describeDb("/documents against Postgres", () => {
  if (!t.ok) return;
  const { unsafeDb, close } = t.db;
  afterAll(() => close());

  const app = createApp({ env: TEST_ENV, db: t.db, logger: silentLogger });
  let wsA: WorkspaceId;
  let wsB: WorkspaceId;

  // Fresh Workspaces per test instead of truncation: sibling suites share the database.
  beforeEach(async () => {
    wsA = newId<WorkspaceId>();
    wsB = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsA, workspaceName: "A" });
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsB, workspaceName: "B" });
  });

  const headers = (ws: WorkspaceId, extra: Record<string, string> = {}) => ({
    [WORKSPACE_HEADER]: ws,
    ...extra,
  });
  const send = (ws: WorkspaceId, method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: headers(ws, body === undefined ? {} : { "content-type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const errorOf = async (res: Response) => ((await res.json()) as ErrorEnvelope).error;
  const documentOf = async (res: Response) =>
    ((await res.json()) as { document: DocumentJson }).document;

  async function seedLesson(ws: WorkspaceId, patch: Partial<Lesson> = {}) {
    return createDocument(forWorkspace(unsafeDb, ws), "lesson", { ...lessonFixture(), ...patch });
  }

  describe("POST /documents", () => {
    test("201: mints a new id and rewrites body.id (Import / Make a copy)", async () => {
      const input = lessonFixture();
      const res = await send(wsA, "POST", "/documents", { kind: "lesson", body: input });
      expect(res.status).toBe(201);
      const doc = await documentOf(res);
      expect(doc.id).not.toBe(input.id);
      expect((doc.body as Lesson).id).toBe(doc.id);
      expect(doc).toMatchObject({
        kind: "lesson",
        title: input.title,
        subject: "Science",
        yearGroup: "Year 4",
        themeId: "chalk",
        itemCount: 3,
        deletedAt: null,
        generatingJobId: null,
      });
      expect(doc.cover).toEqual(input.slides[0] ?? null);
      expect(typeof doc.updatedAt).toBe("string");
    });

    test("422 unprocessable with the parser's message for an invalid body", async () => {
      const input = lessonFixture();
      const slides = input.slides.map((s, i) => (i === 0 ? { ...s, kind: "nope" } : s));
      const res = await send(wsA, "POST", "/documents", {
        kind: "lesson",
        body: { ...input, slides },
      });
      expect(res.status).toBe(422);
      const error = await errorOf(res);
      expect(error.code).toBe("unprocessable");
      expect(error.message).toMatch(/^This file is not a valid TeachDeck lesson\./);
      expect(error.message).toContain("slides.0.kind");
    });

    test("a worksheet and a series are accepted too", async () => {
      const sheet = await send(wsA, "POST", "/documents", {
        kind: "worksheet",
        body: worksheetFixture(),
      });
      expect(sheet.status).toBe(201);
      expect((await documentOf(sheet)).kind).toBe("worksheet");
      const series: Series = {
        id: "s",
        title: "Fortnight",
        lessonIds: [],
        createdAt: "2026-09-01T09:00:00.000Z",
        updatedAt: "2026-09-01T09:00:00.000Z",
      };
      const res = await send(wsA, "POST", "/documents", { kind: "series", body: series });
      expect(res.status).toBe(201);
      expect((await documentOf(res)).itemCount).toBe(0);
    });
  });

  describe("GET /documents", () => {
    test("lists the kind's live summaries without body; other Workspaces are invisible", async () => {
      await seedLesson(wsA, { title: "A1" });
      await seedLesson(wsA, { title: "A2" });
      await createDocument(forWorkspace(unsafeDb, wsA), "worksheet", worksheetFixture());
      await seedLesson(wsB, { title: "B1" });
      const res = await send(wsA, "GET", "/documents?kind=lesson");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: SummaryJson[]; nextCursor: string | null };
      expect(body.items.map((i) => i.title)).toEqual(["A2", "A1"]);
      expect(body.nextCursor).toBeNull();
      for (const item of body.items) {
        expect(item).not.toHaveProperty("body");
        expect(item).not.toHaveProperty("workspaceId");
        expect(item.cover).not.toBeNull();
      }
    });

    test("paginates with cursor, sorts by title and searches with q", async () => {
      // The database collation is en_US.utf8 (pgvector/pgvector:pg16 default, same in CI), so the
      // title sort is case-insensitive — what a teacher expects from an A–Z list.
      for (const title of ["Delta", "alpha", "Charlie", "bravo", "Echo"])
        await seedLesson(wsA, { title });
      const p1 = await send(wsA, "GET", "/documents?kind=lesson&sort=title&limit=2");
      const b1 = (await p1.json()) as { items: SummaryJson[]; nextCursor: string | null };
      expect(b1.items.map((i) => i.title)).toEqual(["alpha", "bravo"]);
      expect(b1.nextCursor).not.toBeNull();
      const p2 = await send(
        wsA,
        "GET",
        `/documents?kind=lesson&sort=title&limit=2&cursor=${encodeURIComponent(b1.nextCursor ?? "")}`,
      );
      const b2 = (await p2.json()) as { items: SummaryJson[] };
      expect(b2.items.map((i) => i.title)).toEqual(["Charlie", "Delta"]);
      const q = await send(wsA, "GET", "/documents?kind=lesson&q=ALPH");
      expect(((await q.json()) as { items: SummaryJson[] }).items.map((i) => i.title)).toEqual([
        "alpha",
      ]);
    });

    test("400 bad_request for a malformed cursor", async () => {
      const res = await send(wsA, "GET", "/documents?kind=lesson&cursor=not-a-cursor");
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toMatchObject({
        code: "bad_request",
        message: "The page cursor is not valid.",
      });
    });
  });

  describe("GET /documents/:id", () => {
    test("200 with the body; 404 for unknown and for another Workspace's id", async () => {
      const row = await seedLesson(wsA);
      const ok = await send(wsA, "GET", `/documents/${row.id}`);
      expect(ok.status).toBe(200);
      expect((await documentOf(ok)).body).toEqual(row.body);
      expect((await send(wsA, "GET", `/documents/${newId()}`)).status).toBe(404);
      const foreign = await send(wsB, "GET", `/documents/${row.id}`);
      expect(foreign.status).toBe(404);
      expect((await errorOf(foreign)).message).toBe("That document does not exist.");
    });

    test("releases a lock whose job has a terminal event, so a following PUT succeeds (ADR 0025 §24)", async () => {
      const jobId = newId<JobId>();
      const row = await createDocument(forWorkspace(unsafeDb, wsA), "lesson", lessonFixture(), {
        generatingJobId: jobId,
      });
      const at = new Date().toISOString();
      await insertJobEvent(unsafeDb, { type: "queued", jobId, workspaceId: wsA, at });
      await insertJobEvent(unsafeDb, { type: "completed", jobId, workspaceId: wsA, at });

      const res = await send(wsA, "GET", `/documents/${row.id}`);
      expect(res.status).toBe(200);
      const doc = await documentOf(res);
      expect(doc.generatingJobId).toBeNull();

      const put = await send(wsA, "PUT", `/documents/${row.id}`, {
        document: { ...row.body, title: "After the dead job" },
        expectedUpdatedAt: doc.updatedAt,
      });
      expect(put.status).toBe(200);
      expect((await documentOf(put)).title).toBe("After the dead job");
    });

    test("keeps a lock whose job is still running", async () => {
      const jobId = newId<JobId>();
      const row = await createDocument(forWorkspace(unsafeDb, wsA), "lesson", lessonFixture(), {
        generatingJobId: jobId,
      });
      const at = new Date().toISOString();
      await insertJobEvent(unsafeDb, { type: "queued", jobId, workspaceId: wsA, at });
      await insertJobEvent(unsafeDb, { type: "started", jobId, workspaceId: wsA, at });
      const res = await send(wsA, "GET", `/documents/${row.id}`);
      expect((await documentOf(res)).generatingJobId).toBe(jobId);
    });
  });

  describe("PUT /documents/:id", () => {
    test("200 with the row's updatedAt: body replaced, updatedAt advanced, title promoted", async () => {
      const row = await seedLesson(wsA);
      const res = await send(wsA, "PUT", `/documents/${row.id}`, {
        document: { ...row.body, title: "Renamed" },
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });
      expect(res.status).toBe(200);
      const doc = await documentOf(res);
      expect(doc.title).toBe("Renamed");
      expect(new Date(doc.updatedAt).getTime()).toBeGreaterThan(row.updatedAt.getTime());
    });

    test("409 conflict reason stale with an old updatedAt", async () => {
      const row = await seedLesson(wsA);
      const first = await send(wsA, "PUT", `/documents/${row.id}`, {
        document: { ...row.body, title: "One" },
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });
      expect(first.status).toBe(200);
      const stale = await send(wsA, "PUT", `/documents/${row.id}`, {
        document: { ...row.body, title: "Two" },
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });
      expect(stale.status).toBe(409);
      expect(await errorOf(stale)).toMatchObject({
        code: "conflict",
        reason: "stale",
        message: "This document changed elsewhere. Reload to continue.",
        retryable: false,
      });
    });

    test("409 conflict reason generating while the lock is held", async () => {
      const jobId = newId<JobId>();
      const row = await createDocument(forWorkspace(unsafeDb, wsA), "lesson", lessonFixture(), {
        generatingJobId: jobId,
      });
      const res = await send(wsA, "PUT", `/documents/${row.id}`, {
        document: { ...row.body, title: "X" },
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });
      expect(res.status).toBe(409);
      expect(await errorOf(res)).toMatchObject({
        code: "conflict",
        reason: "generating",
        message: "This lesson is still being generated.",
      });
    });

    test("422 when document.id differs from the URL; 422 for an invalid document", async () => {
      const row = await seedLesson(wsA);
      const mismatch = await send(wsA, "PUT", `/documents/${row.id}`, {
        document: { ...row.body, id: newId() },
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });
      expect(mismatch.status).toBe(422);
      const invalid = await send(wsA, "PUT", `/documents/${row.id}`, {
        document: { id: row.id, junk: true },
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });
      expect(invalid.status).toBe(422);
      expect((await errorOf(invalid)).message).toMatch(/not a valid TeachDeck lesson/);
    });

    test("404 for another Workspace's id and for an unknown id", async () => {
      const row = await seedLesson(wsA);
      const body = { document: row.body, expectedUpdatedAt: row.updatedAt.toISOString() };
      expect((await send(wsB, "PUT", `/documents/${row.id}`, body)).status).toBe(404);
      const id = newId();
      const unknown = await send(wsA, "PUT", `/documents/${id}`, {
        document: { ...row.body, id },
        expectedUpdatedAt: row.updatedAt.toISOString(),
      });
      expect(unknown.status).toBe(404);
    });
  });

  describe("DELETE + restore", () => {
    test("204; list excludes; GET still 200 with deletedAt; restore brings it back", async () => {
      const row = await seedLesson(wsA);
      const del = await send(wsA, "DELETE", `/documents/${row.id}`);
      expect(del.status).toBe(204);
      const list = (await (await send(wsA, "GET", "/documents?kind=lesson")).json()) as {
        items: SummaryJson[];
      };
      expect(list.items).toHaveLength(0);
      const got = await send(wsA, "GET", `/documents/${row.id}`);
      expect(got.status).toBe(200);
      expect((await documentOf(got)).deletedAt).not.toBeNull();
      // Deleting again is idempotent.
      expect((await send(wsA, "DELETE", `/documents/${row.id}`)).status).toBe(204);

      const restored = await send(wsA, "POST", `/documents/${row.id}/restore`);
      expect(restored.status).toBe(200);
      expect((await documentOf(restored)).deletedAt).toBeNull();
      const after = (await (await send(wsA, "GET", "/documents?kind=lesson")).json()) as {
        items: SummaryJson[];
      };
      expect(after.items.map((i) => i.id)).toEqual([row.id]);
    });

    test("404 for unknown and foreign ids on both", async () => {
      const row = await seedLesson(wsA);
      expect((await send(wsA, "DELETE", `/documents/${newId()}`)).status).toBe(404);
      expect((await send(wsB, "DELETE", `/documents/${row.id}`)).status).toBe(404);
      expect((await send(wsB, "POST", `/documents/${row.id}/restore`)).status).toBe(404);
      expect((await send(wsA, "POST", `/documents/${newId()}/restore`)).status).toBe(404);
    });
  });

  describe("GET /documents/:id/lessons", () => {
    test("returns the series and its live lessons in order; foreign ids drop out", async () => {
      const a = await seedLesson(wsA, { title: "A" });
      const b = await seedLesson(wsA, { title: "B" });
      const other = await seedLesson(wsB, { title: "Other" });
      const series: Series = {
        id: "s",
        title: "Fortnight",
        lessonIds: [b.id, other.id, a.id],
        createdAt: "2026-09-01T09:00:00.000Z",
        updatedAt: "2026-09-01T09:00:00.000Z",
      };
      const created = await documentOf(
        await send(wsA, "POST", "/documents", { kind: "series", body: series }),
      );
      const res = await send(wsA, "GET", `/documents/${created.id}/lessons`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { series: DocumentJson; lessons: SummaryJson[] };
      expect(body.series.id).toBe(created.id);
      expect(body.lessons.map((l) => l.title)).toEqual(["B", "A"]);
      for (const l of body.lessons) expect(l).not.toHaveProperty("body");
    });

    test("404 for a lesson id, an unknown id, and another Workspace's series", async () => {
      const lessonRow = await seedLesson(wsA);
      expect((await send(wsA, "GET", `/documents/${lessonRow.id}/lessons`)).status).toBe(404);
      expect((await send(wsA, "GET", `/documents/${newId()}/lessons`)).status).toBe(404);
      const series = await createDocument(forWorkspace(unsafeDb, wsA), "series", {
        id: "s",
        title: "S",
        lessonIds: [],
        createdAt: "2026-09-01T09:00:00.000Z",
        updatedAt: "2026-09-01T09:00:00.000Z",
      });
      expect((await send(wsB, "GET", `/documents/${series.id}/lessons`)).status).toBe(404);
    });
  });
});
