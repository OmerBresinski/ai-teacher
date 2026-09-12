/**
 * `POST /sources` and `DELETE /sources/:id` (ADR 0027 §5) against TEST_DATABASE_URL with a
 * `LocalDiskStorage` in a temp dir and the generated documents from `@tj/extract/testing`. Skips
 * visibly when the database is unreachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindSourcesToLesson, forWorkspace, getSource } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { newId, storageKey, type WorkspaceId } from "@tj/domain";
import { ExtractedSourceSchema, type SourceRef } from "@tj/domain/documents";
import { docxWith, PHOTOSYNTHESIS, pdfWithPages, ROSTER_ROWS, TINY_PNG } from "@tj/extract/testing";
import { LocalDiskStorage } from "@tj/storage";
import { createApp } from "../app";
import type { ErrorEnvelope } from "../errors";
import { silentLogger, TEST_ENV, TEST_ENV_NO_SHIM } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";
import { REFUSAL_MESSAGES, SOURCE_BOUND_MESSAGE, TOO_LARGE_MESSAGE } from "./sources";

const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping /sources tests: ${t.reason}`);

describeDb("POST /sources and DELETE /sources/:id", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, truncateTenantTables, close } = t.db;
  let root: string;
  let storage: LocalDiskStorage;
  let app: ReturnType<typeof createApp>;
  const wsA = newId<WorkspaceId>();
  const wsB = newId<WorkspaceId>();

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "tj-api-sources-"));
    storage = new LocalDiskStorage(root);
    app = createApp({
      env: TEST_ENV,
      db: t.db,
      logger: silentLogger,
      storage,
      sourceRateLimit: { limit: 5, windowMs: 60_000 },
    });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await close();
  });

  beforeEach(async () => {
    await truncateTenantTables();
    await rm(root, { recursive: true, force: true });
    storage = new LocalDiskStorage(root);
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsA, workspaceName: "A" });
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsB, workspaceName: "B" });
    // Fresh app per test so the per-Workspace limiter starts empty.
    app = createApp({
      env: TEST_ENV,
      db: t.db,
      logger: silentLogger,
      storage,
      sourceRateLimit: { limit: 5, windowMs: 60_000 },
    });
  });

  const upload = (
    ws: WorkspaceId,
    parts: { file?: { bytes: Uint8Array; name: string }; text?: string; name?: string },
    extraHeaders: Record<string, string> = {},
    theApp = app,
  ) => {
    const form = new FormData();
    if (parts.file)
      form.set("file", new File([parts.file.bytes as unknown as ArrayBuffer], parts.file.name));
    if (parts.text !== undefined) form.set("text", parts.text);
    if (parts.name !== undefined) form.set("name", parts.name);
    return theApp.request("/sources", {
      method: "POST",
      headers: { [WORKSPACE_HEADER]: ws, ...extraHeaders },
      body: form,
    });
  };
  const errorOf = async (res: Response) => ((await res.json()) as ErrorEnvelope).error;
  const objectsUnder = async (ws: WorkspaceId, id: string) => {
    const keys: string[] = [];
    for await (const o of storage.list(`${storageKey(ws, "sources", id)}/`)) keys.push(o.key);
    return keys.sort();
  };

  test("401 without a session or shim; 403 cross-site", async () => {
    const noShim = createApp({ env: TEST_ENV_NO_SHIM, db: t.db, logger: silentLogger, storage });
    const pdf = await pdfWithPages(PHOTOSYNTHESIS);
    expect((await upload(wsA, { file: { bytes: pdf, name: "a.pdf" } }, {}, noShim)).status).toBe(
      401,
    );
    expect(
      (
        await upload(
          wsA,
          { file: { bytes: pdf, name: "a.pdf" } },
          {
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
          },
        )
      ).status,
    ).toBe(403);
  });

  test("503 when storage is not configured", async () => {
    const bare = createApp({ env: TEST_ENV, db: t.db, logger: silentLogger });
    const res = await upload(wsA, { text: PHOTOSYNTHESIS.join("\n") }, {}, bare);
    expect(res.status).toBe(503);
  });

  test("a PDF is extracted, screened, stored under its id and registered: 201 with the SourceRef", async () => {
    const pdf = await pdfWithPages(PHOTOSYNTHESIS);
    const res = await upload(wsA, { file: { bytes: pdf, name: "plants.pdf" } });
    expect(res.status).toBe(201);
    const { source } = (await res.json()) as { source: SourceRef };
    expect(source).toMatchObject({ kind: "file", name: "plants.pdf", pages: 2 });
    expect(source.storageKey).toBe(storageKey(wsA, "sources", source.id, "original.pdf"));

    const row = await getSource(forWorkspace(unsafeDb, wsA), source.id);
    expect(row).toMatchObject({
      kind: "file",
      mime: "application/pdf",
      byteSize: pdf.byteLength,
      pages: 2,
      lowText: false,
      lessonId: null,
    });
    expect(await objectsUnder(wsA, source.id)).toEqual([
      storageKey(wsA, "sources", source.id, "extracted.json"),
      storageKey(wsA, "sources", source.id, "original.pdf"),
    ]);
    const extracted = ExtractedSourceSchema.parse(
      JSON.parse(
        await new Response(
          (await storage.get(storageKey(wsA, "sources", source.id, "extracted.json"))).body,
        ).text(),
      ),
    );
    expect(extracted).toMatchObject({ version: 1, sourceId: source.id, kind: "pdf", pages: 2 });
    expect(extracted.chunks.map((c) => c.ref)).toEqual([{ page: 1 }, { page: 2 }]);
  });

  test("the declared file type is ignored: a PNG named .pdf is unsupported and nothing is stored", async () => {
    const res = await upload(wsA, { file: { bytes: TINY_PNG, name: "sneaky.pdf" } });
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({
      code: "unprocessable",
      reason: "unsupported",
      message: REFUSAL_MESSAGES.unsupported(),
    });
    const listed: string[] = [];
    for await (const o of storage.list(`${wsA}/`)) listed.push(o.key);
    expect(listed).toEqual([]);
  });

  test("pasted text becomes a paste Source with original.txt", async () => {
    const res = await upload(wsA, { text: PHOTOSYNTHESIS.join("\n"), name: "Notes" });
    expect(res.status).toBe(201);
    const { source } = (await res.json()) as { source: SourceRef };
    expect(source).toMatchObject({ kind: "paste", name: "Notes", pages: 1 });
    expect(source.storageKey).toBe(storageKey(wsA, "sources", source.id, "original.txt"));
  });

  test("a class list in a DOCX is refused as a roster with the section named; nothing stored, no row", async () => {
    const docx = await docxWith([
      { heading: "Class 5B", paragraphs: [PHOTOSYNTHESIS[0] ?? ""], table: ROSTER_ROWS },
    ]);
    const res = await upload(wsA, { file: { bytes: docx, name: "register.docx" } });
    expect(res.status).toBe(422);
    const error = await errorOf(res);
    expect(error).toMatchObject({ code: "unprocessable", reason: "roster" });
    expect(error.message).toBe(REFUSAL_MESSAGES.roster('the section "Class 5B"'));
    const listed: string[] = [];
    for await (const o of storage.list(`${wsA}/`)) listed.push(o.key);
    expect(listed).toEqual([]);
  });

  test("a pupil identifier anywhere is refused with its page", async () => {
    const pdf = await pdfWithPages([
      PHOTOSYNTHESIS[0] ?? "",
      "Email your answers to j.smith@school.org by Friday.",
    ]);
    const res = await upload(wsA, { file: { bytes: pdf, name: "hw.pdf" } });
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({
      reason: "identifiers",
      message: REFUSAL_MESSAGES.identifiers("page 2"),
    });
  });

  test("a scanned-looking PDF (no text, no images) is unreadable", async () => {
    const res = await upload(wsA, {
      file: { bytes: await pdfWithPages(["", "", ""]), name: "scan.pdf" },
    });
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ reason: "unreadable" });
  });

  test("a 301-slide deck is too-long, with the count in the message; nothing stored, no row", async () => {
    const deck = await pptxWith(
      Array.from({ length: 301 }, (_, i) => ({
        paragraphs: [`Slide ${i + 1}: ${PHOTOSYNTHESIS[0]}`],
      })),
    );
    const res = await upload(wsA, { file: { bytes: deck, name: "long.pptx" } });
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({
      code: "unprocessable",
      reason: "too-long",
      message: REFUSAL_MESSAGES.tooLong(301),
    });
    const listed: string[] = [];
    for await (const o of storage.list(`${wsA}/`)) listed.push(o.key);
    expect(listed).toEqual([]);
    const rows = await sql`select count(*)::int as n from sources where workspace_id = ${wsA}`;
    expect(rows[0]?.n).toBe(0);
  }, 20_000);

  test("neither file nor text, or both, is a validation error", async () => {
    expect((await upload(wsA, {})).status).toBe(400);
    const pdf = await pdfWithPages(PHOTOSYNTHESIS);
    expect((await upload(wsA, { file: { bytes: pdf, name: "a.pdf" }, text: "x" })).status).toBe(
      400,
    );
  });

  test("a file over 25 MB is 413 without being parsed", async () => {
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const res = await upload(wsA, { file: { bytes: big, name: "huge.pdf" } });
    expect(res.status).toBe(413);
    expect((await errorOf(res)).message).toBe(TOO_LARGE_MESSAGE);
  }, 20_000);

  test("the per-Workspace limiter answers 429 after the allowance", async () => {
    const text = PHOTOSYNTHESIS.join("\n");
    for (let i = 0; i < 5; i++) expect((await upload(wsA, { text })).status).toBe(201);
    const res = await upload(wsA, { text });
    expect(res.status).toBe(429);
    expect((await upload(wsB, { text })).status).toBe(201);
  });

  test("a storage failure after the row is written rolls back: 503, row soft-deleted, objects gone", async () => {
    const failing = createApp({
      env: TEST_ENV,
      db: t.db,
      logger: silentLogger,
      storage: {
        ...storage,
        put: (
          key: string,
          body: Uint8Array | ReadableStream<Uint8Array>,
          opts: { contentType: string },
        ) =>
          key.endsWith("extracted.json")
            ? Promise.reject(new Error("bucket down"))
            : storage.put(key, body, opts),
        get: storage.get.bind(storage),
        delete: storage.delete.bind(storage),
        list: storage.list.bind(storage),
        getSignedUrl: storage.getSignedUrl.bind(storage),
      },
    });
    const pdf = await pdfWithPages(PHOTOSYNTHESIS);
    const res = await upload(wsA, { file: { bytes: pdf, name: "plants.pdf" } }, {}, failing);
    expect(res.status).toBe(503);
    const listed: string[] = [];
    for await (const o of storage.list(`${wsA}/`)) listed.push(o.key);
    expect(listed).toEqual([]);
  });

  describe("DELETE /sources/:id", () => {
    async function stored(ws: WorkspaceId): Promise<SourceRef> {
      const res = await upload(ws, { text: PHOTOSYNTHESIS.join("\n") });
      expect(res.status).toBe(201);
      return ((await res.json()) as { source: SourceRef }).source;
    }
    const del = (ws: WorkspaceId, id: string) =>
      app.request(`/sources/${id}`, { method: "DELETE", headers: { [WORKSPACE_HEADER]: ws } });

    test("204 for an unbound Source: row soft-deleted and objects removed", async () => {
      const source = await stored(wsA);
      expect((await objectsUnder(wsA, source.id)).length).toBe(2);
      const res = await del(wsA, source.id);
      expect(res.status).toBe(204);
      expect(await getSource(forWorkspace(unsafeDb, wsA), source.id)).toBeNull();
      expect(await objectsUnder(wsA, source.id)).toEqual([]);
      expect((await del(wsA, source.id)).status).toBe(404);
    });

    test("409 for a Source a lesson holds; 404 from another Workspace; 400 for a non-uuid", async () => {
      const source = await stored(wsA);
      await bindSourcesToLesson(forWorkspace(unsafeDb, wsA), [source.id], newId());
      const bound = await del(wsA, source.id);
      expect(bound.status).toBe(409);
      expect((await errorOf(bound)).message).toBe(SOURCE_BOUND_MESSAGE);
      expect((await del(wsB, source.id)).status).toBe(404);
      expect((await del(wsA, "nope")).status).toBe(400);
    });
  });
});
