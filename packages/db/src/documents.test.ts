import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { type JobId, newId, type WorkspaceId } from "@tj/domain";
import { type Lesson, type Series, summarise } from "@tj/domain/documents";
import {
  lesson as lessonFixture,
  titleSlide,
  worksheet as worksheetFixture,
} from "@tj/domain/documents/fixtures";
import { eq } from "drizzle-orm";
import {
  clearGenerating,
  createDocument,
  deleteDocument,
  escapeLike,
  getDocument,
  getSeriesWithLessons,
  listSummaries,
  MalformedCursorError,
  putDocument,
  restore,
  softDelete,
} from "./documents";
import { documents } from "./schema/documents";
import { forWorkspace, type WorkspaceDb } from "./tenant";
import { createTestUserWithWorkspace, withTestDb } from "./testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping documents tests: ${t.reason}`);

const series = (lessonIds: string[]): Series => ({
  id: "s",
  title: "Fractions fortnight",
  lessonIds,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-05T15:30:00.000Z",
});

describeDb("documents repository", () => {
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const wsAId = newId<WorkspaceId>();
  const wsBId = newId<WorkspaceId>();
  let wsA: WorkspaceDb;
  let wsB: WorkspaceDb;

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsAId, workspaceName: "A" });
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsBId, workspaceName: "B" });
    wsA = forWorkspace(unsafeDb, wsAId);
    wsB = forWorkspace(unsafeDb, wsBId);
  });

  describe("createDocument", () => {
    test("mints the id, rewrites body.id and writes the promoted columns from summarise()", async () => {
      const input = lessonFixture();
      const row = await createDocument(wsA, "lesson", input);
      expect(row.id).not.toBe(input.id);
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect((row.body as Lesson).id).toBe(row.id);
      expect(row.kind).toBe("lesson");
      expect(row.workspaceId).toBe(wsAId);
      const s = summarise({ ...input, id: row.id });
      expect(row.title).toBe(s.title);
      expect(row.subject).toBe(s.subject ?? null);
      expect(row.yearGroup).toBe(s.yearGroup ?? null);
      expect(row.themeId).toBe(s.themeId ?? null);
      expect(row.itemCount).toBe(s.itemCount);
      expect(row.cover).toEqual(s.cover);
      expect(row.deletedAt).toBeNull();
      expect(row.generatingJobId).toBeNull();
      expect(row.createdAt.getTime()).toBe(row.updatedAt.getTime());
    });

    test("throws the parser's message and writes nothing when the body is invalid", async () => {
      await expect(
        createDocument(wsA, "lesson", { version: 1, id: 1, slides: "no" }),
      ).rejects.toThrow(/not a valid TeachDeck lesson/);
      expect(await wsA.select(documents)).toHaveLength(0);
    });

    test("stores the generating lock when asked", async () => {
      const jobId = newId<JobId>();
      const row = await createDocument(wsA, "lesson", lessonFixture(), { generatingJobId: jobId });
      expect(row.generatingJobId).toBe(jobId);
    });

    test("a worksheet and a series get their own promoted columns", async () => {
      const w = await createDocument(wsA, "worksheet", worksheetFixture());
      expect(w).toMatchObject({
        kind: "worksheet",
        itemCount: 5,
        cover: null,
        themeId: "playground",
      });
      const s = await createDocument(wsA, "series", series(["a", "b", "c"]));
      expect(s).toMatchObject({ kind: "series", itemCount: 3, cover: null, themeId: null });
    });
  });

  describe("getDocument", () => {
    test("returns the row with body, null for an unknown id and for another Workspace's id", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      expect((await getDocument(wsA, row.id))?.body).toEqual(row.body);
      expect(await getDocument(wsA, newId())).toBeNull();
      expect(await getDocument(wsB, row.id)).toBeNull();
    });

    test("returns soft-deleted rows (the caller decides)", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      await softDelete(wsA, row.id);
      expect((await getDocument(wsA, row.id))?.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("putDocument", () => {
    test("ok: replaces the body, advances updated_at and recomputes the promoted columns", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      const body = row.body as Lesson;
      const next: Lesson = { ...body, title: "Renamed", slides: [...body.slides, titleSlide()] };
      const result = await putDocument(wsA, row.id, next, row.updatedAt);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.row.title).toBe("Renamed");
      expect(result.row.itemCount).toBe(4);
      expect(result.row.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
      expect((result.row.body as Lesson).slides).toHaveLength(4);
    });

    test("two writes inside one millisecond still get distinct updated_at values", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      // Force the row's clock to "now" so the next write lands in the same millisecond window.
      const pinned = new Date();
      await unsafeDb.update(documents).set({ updatedAt: pinned }).where(eq(documents.id, row.id));
      const first = await putDocument(wsA, row.id, { ...row.body, title: "One" }, pinned);
      expect(first.status).toBe("ok");
      if (first.status !== "ok") return;
      expect(first.row.updatedAt.getTime()).toBeGreaterThan(pinned.getTime());
      const stale = await putDocument(wsA, row.id, { ...row.body, title: "Two" }, pinned);
      expect(stale.status).toBe("conflict");
    });

    test("conflict: a stale expectedUpdatedAt returns the current row unchanged", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      const first = await putDocument(wsA, row.id, { ...row.body, title: "One" }, row.updatedAt);
      expect(first.status).toBe("ok");
      const stale = await putDocument(wsA, row.id, { ...row.body, title: "Two" }, row.updatedAt);
      expect(stale.status).toBe("conflict");
      if (stale.status !== "conflict") return;
      expect(stale.row.title).toBe("One");
    });

    test("generating: a locked row is not written and the job id is reported", async () => {
      const jobId = newId<JobId>();
      const row = await createDocument(wsA, "lesson", lessonFixture(), { generatingJobId: jobId });
      const result = await putDocument(wsA, row.id, { ...row.body, title: "X" }, row.updatedAt);
      expect(result).toEqual({ status: "generating", jobId });
      expect((await getDocument(wsA, row.id))?.title).toBe("The water cycle");
    });

    test("missing: unknown id and another Workspace's id", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      expect(await putDocument(wsA, newId(), row.body, row.updatedAt)).toEqual({
        status: "missing",
      });
      expect(await putDocument(wsB, row.id, row.body, row.updatedAt)).toEqual({
        status: "missing",
      });
    });

    test("throws when body.id does not match the document id", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      await expect(
        putDocument(wsA, row.id, { ...row.body, id: "other" }, row.updatedAt),
      ).rejects.toThrow(/body\.id other does not match/);
    });

    test("throws the parser's message for an invalid body", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      await expect(putDocument(wsA, row.id, { junk: true }, row.updatedAt)).rejects.toThrow(
        /not a valid TeachDeck lesson/,
      );
    });
  });

  describe("listSummaries", () => {
    const seedLesson = (title: string, extra: Partial<Lesson> = {}) =>
      createDocument(wsA, "lesson", { ...lessonFixture(), title, ...extra });

    test("returns the kind's live rows without body, newest updated first", async () => {
      for (let i = 1; i <= 4; i++) await seedLesson(`L${i}`);
      await createDocument(wsA, "worksheet", worksheetFixture());
      await createDocument(wsA, "worksheet", { ...worksheetFixture(), title: "W2" });
      const deleted = await seedLesson("Gone");
      await softDelete(wsA, deleted.id);
      await createDocument(wsB, "lesson", { ...lessonFixture(), title: "Other tenant" });

      const page = await listSummaries(wsA, { kind: "lesson" });
      expect(page.items).toHaveLength(4);
      expect(page.nextCursor).toBeNull();
      expect(page.items.map((r) => r.title)).toEqual(["L4", "L3", "L2", "L1"]);
      for (const item of page.items) expect(item).not.toHaveProperty("body");
      expect(page.items[0]).toHaveProperty("generatingJobId", null);
      expect(page.items[0]).toHaveProperty("deletedAt", null);
    });

    test("pages 250 rows as 100, 100, 50 in a stable, disjoint order", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 250; i++) ids.push((await seedLesson(`Lesson ${i}`)).id);
      const seen = new Set<string>();
      let cursor: string | undefined;
      const sizes: number[] = [];
      let previous: { updatedAt: Date; id: string } | null = null;
      for (let i = 0; i < 3; i++) {
        const page = await listSummaries(wsA, { kind: "lesson", limit: 100, cursor });
        sizes.push(page.items.length);
        for (const item of page.items) {
          expect(seen.has(item.id)).toBe(false);
          seen.add(item.id);
          if (previous !== null) {
            const later =
              item.updatedAt.getTime() < previous.updatedAt.getTime() ||
              (item.updatedAt.getTime() === previous.updatedAt.getTime() && item.id < previous.id);
            expect(later).toBe(true);
          }
          previous = { updatedAt: item.updatedAt, id: item.id };
        }
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(sizes).toEqual([100, 100, 50]);
      expect(seen.size).toBe(250);
      const lastPage = await listSummaries(wsA, { kind: "lesson", limit: 100, cursor });
      expect(lastPage.nextCursor).toBeNull();
    });

    test("sort=title with q matches title or subject case-insensitively, ascending", async () => {
      await seedLesson("Zebra fractions");
      await seedLesson("Adding FRACtions");
      await seedLesson("Shapes", { subject: "Fractions and decimals" });
      await seedLesson("Unrelated", { subject: "History" });
      const page = await listSummaries(wsA, { kind: "lesson", sort: "title", q: "frac" });
      expect(page.items.map((r) => r.title)).toEqual([
        "Adding FRACtions",
        "Shapes",
        "Zebra fractions",
      ]);
    });

    test("keyset paging works for the title sort too", async () => {
      for (const title of ["B", "A", "D", "C", "E"]) await seedLesson(title);
      const p1 = await listSummaries(wsA, { kind: "lesson", sort: "title", limit: 2 });
      expect(p1.items.map((r) => r.title)).toEqual(["A", "B"]);
      const p2 = await listSummaries(wsA, {
        kind: "lesson",
        sort: "title",
        limit: 2,
        cursor: p1.nextCursor ?? undefined,
      });
      expect(p2.items.map((r) => r.title)).toEqual(["C", "D"]);
      const p3 = await listSummaries(wsA, {
        kind: "lesson",
        sort: "title",
        limit: 2,
        cursor: p2.nextCursor ?? undefined,
      });
      expect(p3.items.map((r) => r.title)).toEqual(["E"]);
      expect(p3.nextCursor).toBeNull();
    });

    test("q escapes % and _ so they match literally", async () => {
      await seedLesson("Scoring 100% in tests");
      await seedLesson("Scoring 100 in tests");
      await seedLesson("snake_case");
      await seedLesson("snakeXcase");
      expect(
        (await listSummaries(wsA, { kind: "lesson", q: "100%" })).items.map((r) => r.title),
      ).toEqual(["Scoring 100% in tests"]);
      expect(
        (await listSummaries(wsA, { kind: "lesson", q: "snake_" })).items.map((r) => r.title),
      ).toEqual(["snake_case"]);
      expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    });

    test("sort=created orders by created_at descending", async () => {
      const first = await seedLesson("First");
      await seedLesson("Second");
      // Touch the first so updated ≠ created order.
      await putDocument(wsA, first.id, { ...first.body, title: "First" }, first.updatedAt);
      const byCreated = await listSummaries(wsA, { kind: "lesson", sort: "created" });
      expect(byCreated.items.map((r) => r.title)).toEqual(["Second", "First"]);
      const byUpdated = await listSummaries(wsA, { kind: "lesson" });
      expect(byUpdated.items.map((r) => r.title)).toEqual(["First", "Second"]);
    });

    test("clamps limit to 1–200", async () => {
      await seedLesson("Only");
      expect((await listSummaries(wsA, { kind: "lesson", limit: 0 })).items).toHaveLength(1);
      expect((await listSummaries(wsA, { kind: "lesson", limit: 9999 })).items).toHaveLength(1);
    });

    test("rejects cursors it did not produce with MalformedCursorError", async () => {
      await seedLesson("A");
      await seedLesson("B");
      const encode = (value: unknown) =>
        Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
      const page = await listSummaries(wsA, { kind: "lesson", limit: 1 });
      const valid = page.nextCursor ?? "";
      const rejects = async (cursor: string, sort: "updated" | "title" | "created" = "updated") =>
        expect(listSummaries(wsA, { kind: "lesson", sort, cursor })).rejects.toThrow(
          MalformedCursorError,
        );
      await rejects("not-a-cursor");
      await rejects(encode("a string"));
      await rejects(encode({ v: "x", id: "y" }));
      await rejects(encode({ s: "updated", v: "not-a-date", id: newId() }));
      await rejects(encode({ s: "updated", v: new Date().toISOString(), id: "not-a-uuid" }));
      await rejects(encode({ s: "updated", v: new Date().toISOString(), id: newId(), extra: 1 }));
      // A cursor from one sort cannot be replayed under another.
      await rejects(valid, "title");
      await rejects(valid, "created");
      // The real one still works for its own sort.
      expect(
        (await listSummaries(wsA, { kind: "lesson", limit: 1, cursor: valid })).items,
      ).toHaveLength(1);
    });
  });

  describe("getSeriesWithLessons", () => {
    test("resolves lessonIds in order, dropping foreign, deleted and non-lesson ids", async () => {
      const a = await createDocument(wsA, "lesson", { ...lessonFixture(), title: "A" });
      const b = await createDocument(wsA, "lesson", { ...lessonFixture(), title: "B" });
      const foreign = await createDocument(wsB, "lesson", { ...lessonFixture(), title: "F" });
      const deleted = await createDocument(wsA, "lesson", { ...lessonFixture(), title: "D" });
      await softDelete(wsA, deleted.id);
      const sheet = await createDocument(wsA, "worksheet", worksheetFixture());
      const s = await createDocument(
        wsA,
        "series",
        series([b.id, foreign.id, deleted.id, sheet.id, a.id, newId()]),
      );
      const result = await getSeriesWithLessons(wsA, s.id);
      expect(result?.series.id).toBe(s.id);
      expect(result?.lessons.map((l) => l.title)).toEqual(["B", "A"]);
      for (const l of result?.lessons ?? []) expect(l).not.toHaveProperty("body");
    });

    test("null for a non-series id, an unknown id, or another Workspace's series", async () => {
      const l = await createDocument(wsA, "lesson", lessonFixture());
      const s = await createDocument(wsA, "series", series([]));
      expect(await getSeriesWithLessons(wsA, l.id)).toBeNull();
      expect(await getSeriesWithLessons(wsA, newId())).toBeNull();
      expect(await getSeriesWithLessons(wsB, s.id)).toBeNull();
      expect(await getSeriesWithLessons(wsA, s.id)).toEqual({ series: s, lessons: [] });
    });
  });

  describe("softDelete / restore", () => {
    test("sets then clears deleted_at, and the list excludes then includes the row", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      expect(await softDelete(wsA, row.id)).toBe(true);
      expect(await softDelete(wsA, row.id)).toBe(false);
      const deleted = await getDocument(wsA, row.id);
      expect(deleted?.deletedAt).toBeInstanceOf(Date);
      expect(deleted?.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
      expect((await listSummaries(wsA, { kind: "lesson" })).items).toHaveLength(0);
      expect(await restore(wsA, row.id)).toBe(true);
      expect(await restore(wsA, row.id)).toBe(false);
      const restored = await getDocument(wsA, row.id);
      expect(restored?.deletedAt).toBeNull();
      expect(restored?.updatedAt.getTime()).toBeGreaterThan(deleted?.updatedAt.getTime() ?? 0);
      expect((await listSummaries(wsA, { kind: "lesson" })).items).toHaveLength(1);
    });

    test("a pre-delete snapshot is stale after delete + restore", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      await softDelete(wsA, row.id);
      await restore(wsA, row.id);
      const put = await putDocument(wsA, row.id, { ...row.body, title: "Old" }, row.updatedAt);
      expect(put.status).toBe("conflict");
    });

    test("restore moves the document to the top of the updated order", async () => {
      const first = await createDocument(wsA, "lesson", { ...lessonFixture(), title: "First" });
      await createDocument(wsA, "lesson", { ...lessonFixture(), title: "Second" });
      await softDelete(wsA, first.id);
      await restore(wsA, first.id);
      const page = await listSummaries(wsA, { kind: "lesson" });
      expect(page.items.map((r) => r.title)).toEqual(["First", "Second"]);
    });

    test("neither touches another Workspace's row", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      expect(await softDelete(wsB, row.id)).toBe(false);
      expect((await getDocument(wsA, row.id))?.deletedAt).toBeNull();
    });
  });

  describe("deleteDocument", () => {
    test("removes the row for its Workspace only", async () => {
      const row = await createDocument(wsA, "lesson", lessonFixture());
      expect(await deleteDocument(wsB, row.id)).toBe(false);
      expect(await getDocument(wsA, row.id)).not.toBeNull();
      expect(await deleteDocument(wsA, row.id)).toBe(true);
      expect(await getDocument(wsA, row.id)).toBeNull();
      expect(await deleteDocument(wsA, row.id)).toBe(false);
    });
  });

  describe("clearGenerating", () => {
    test("clears only when the lock is held by that job", async () => {
      const jobId = newId<JobId>();
      const row = await createDocument(wsA, "lesson", lessonFixture(), { generatingJobId: jobId });
      await clearGenerating(wsA, row.id, newId<JobId>());
      expect((await getDocument(wsA, row.id))?.generatingJobId).toBe(jobId);
      await clearGenerating(wsB, row.id, jobId);
      expect((await getDocument(wsA, row.id))?.generatingJobId).toBe(jobId);
      await clearGenerating(wsA, row.id, jobId);
      expect((await getDocument(wsA, row.id))?.generatingJobId).toBeNull();
      // Unlocked: a PUT goes through.
      const after = await getDocument(wsA, row.id);
      if (!after) throw new Error("row vanished");
      const put = await putDocument(wsA, row.id, { ...after.body, title: "Now" }, after.updatedAt);
      expect(put.status).toBe("ok");
    });
  });

  test("the tenant predicate is on every statement (raw count check)", async () => {
    await createDocument(wsA, "lesson", lessonFixture());
    await createDocument(wsB, "lesson", lessonFixture());
    const all = await unsafeDb.select().from(documents);
    expect(all).toHaveLength(2);
    expect(await wsA.select(documents, eq(documents.kind, "lesson"))).toHaveLength(1);
  });
});
