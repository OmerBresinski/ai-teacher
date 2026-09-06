/**
 * Unit rows for `/documents/*` that never reach the database: authentication, CSRF, query and
 * body validation, the body cap, and the serialisers. Data rows live in
 * `documents.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "@tj/domain";
import { lesson as lessonFixture } from "@tj/domain/documents/fixtures";
import { createApp } from "../app";
import type { ErrorEnvelope } from "../errors";
import { fakeSql, silentLogger, TEST_ENV_NO_SHIM, testApp } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";
import { DOCUMENT_BODY_LIMIT_BYTES, toDocumentJson, toSummaryJson } from "./documents";

const ws = newId<WorkspaceId>();
const headers = (extra: Record<string, string> = {}) => ({ [WORKSPACE_HEADER]: ws, ...extra });
const json = (body: unknown) => ({
  method: "POST",
  headers: headers({ "content-type": "application/json" }),
  body: JSON.stringify(body),
});
const errorBody = (res: Response) => res.json() as Promise<ErrorEnvelope>;

describe("/documents guards", () => {
  test("401 without a session or shim on the bare and nested paths", async () => {
    const app = createApp({ env: TEST_ENV_NO_SHIM, db: fakeSql(true), logger: silentLogger });
    for (const path of ["/documents?kind=lesson", `/documents/${newId()}`]) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
      expect((await errorBody(res)).error.code).toBe("unauthorized");
    }
    const post = await app.request("/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(post.status).toBe(401);
  });

  test("403 for a cross-site PUT (CSRF guard runs on /documents/*)", async () => {
    const res = await testApp().request(`/documents/${newId()}`, {
      method: "PUT",
      headers: headers({
        "content-type": "application/json",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      }),
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
});

describe("/documents validation", () => {
  test("400 validation_failed with fields for a bad kind", async () => {
    const res = await testApp().request("/documents?kind=bogus", { headers: headers() });
    expect(res.status).toBe(400);
    expect((await errorBody(res)).error).toMatchObject({
      code: "validation_failed",
      fields: ["kind"],
    });
  });

  test("400 for limit over 200, a bad sort, or a long q", async () => {
    for (const query of [
      "kind=lesson&limit=500",
      "kind=lesson&sort=size",
      `kind=lesson&q=${"a".repeat(101)}`,
    ]) {
      const res = await testApp().request(`/documents?${query}`, { headers: headers() });
      expect(res.status).toBe(400);
    }
  });

  test("400 for a non-uuid id", async () => {
    const res = await testApp().request("/documents/not-a-uuid", { headers: headers() });
    expect(res.status).toBe(400);
    expect((await errorBody(res)).error.fields).toEqual(["id"]);
  });

  test("400 when POST has no JSON content type or a bad shape", async () => {
    const noType = await testApp().request("/documents", {
      method: "POST",
      headers: headers(),
      body: "{}",
    });
    expect(noType.status).toBe(400);
    const badShape = await testApp().request("/documents", json({ kind: "lesson" }));
    expect(badShape.status).toBe(400);
    expect((await errorBody(badShape)).error.fields).toEqual(["body"]);
  });

  test("400 when PUT lacks expectedUpdatedAt or sends a non-ISO value", async () => {
    const res = await testApp().request(`/documents/${newId()}`, {
      ...json({ document: {}, expectedUpdatedAt: "yesterday" }),
      method: "PUT",
    });
    expect(res.status).toBe(400);
    expect((await errorBody(res)).error.fields).toEqual(["expectedUpdatedAt"]);
  });

  test("413 payload_too_large for a body over the cap, before it is parsed", async () => {
    const padding = "x".repeat(DOCUMENT_BODY_LIMIT_BYTES + 1024);
    const res = await testApp().request(`/documents/${newId()}`, {
      ...json({ document: { id: "x", padding }, expectedUpdatedAt: new Date().toISOString() }),
      method: "PUT",
    });
    expect(res.status).toBe(413);
    expect((await errorBody(res)).error).toMatchObject({
      code: "payload_too_large",
      message: "This document is too large to save (10 MB limit).",
    });
  });
});

describe("serialisers", () => {
  const now = new Date("2026-09-06T10:00:00.123Z");
  const row = {
    id: newId(),
    workspaceId: ws,
    kind: "lesson" as const,
    body: lessonFixture(),
    title: "The water cycle",
    subject: null,
    yearGroup: "Year 4",
    themeId: "chalk",
    itemCount: 3,
    cover: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    generatingJobId: null,
  };

  test("toSummaryJson: ISO strings, nulls become absent optionals, no body, no workspaceId", () => {
    const { body: _body, ...summaryRow } = row;
    const summary = toSummaryJson(summaryRow);
    expect(summary).toEqual({
      id: row.id,
      kind: "lesson",
      title: "The water cycle",
      subject: undefined,
      yearGroup: "Year 4",
      themeId: "chalk",
      itemCount: 3,
      cover: null,
      createdAt: "2026-09-06T10:00:00.123Z",
      updatedAt: "2026-09-06T10:00:00.123Z",
      deletedAt: null,
      generatingJobId: null,
    });
    expect(JSON.parse(JSON.stringify(summary))).not.toHaveProperty("subject");
    expect(summary).not.toHaveProperty("body");
    expect(summary).not.toHaveProperty("workspaceId");
  });

  test("toDocumentJson: the summary plus the body", () => {
    const doc = toDocumentJson({ ...row, deletedAt: now });
    expect(doc.body).toEqual(lessonFixture());
    expect(doc.deletedAt).toBe("2026-09-06T10:00:00.123Z");
    expect(doc).not.toHaveProperty("workspaceId");
  });
});
