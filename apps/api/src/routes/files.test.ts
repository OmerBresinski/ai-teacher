/**
 * `GET /files/:key` against `LocalDiskStorage` in a temp dir (ADR 0011 amendment): bytes are
 * streamed for the caller's Workspace, other Workspaces' keys are 404 (never 403), no session is
 * 401, and no storage adapter is 503.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId, storageKey, type WorkspaceId } from "@tj/domain";
import { LocalDiskStorage } from "@tj/storage";
import { createApp } from "../app";
import { fakeSql, silentLogger, TEST_ENV } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";

const ws = newId<WorkspaceId>();
const other = newId<WorkspaceId>();
const bytes = new TextEncoder().encode("%PDF-1.7 hello teaching journey");

let root: string;
let app: ReturnType<typeof createApp>;
let key: string;
let foreignKey: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "tj-api-files-"));
  const storage = new LocalDiskStorage(root);
  key = storageKey(ws, "exports", "lesson 1.pdf");
  foreignKey = storageKey(other, "exports", "secret.pdf");
  await storage.put(key, bytes, { contentType: "application/pdf" });
  await storage.put(foreignKey, bytes, { contentType: "application/pdf" });
  app = createApp({ env: TEST_ENV, db: fakeSql(true), logger: silentLogger, storage });
});

afterAll(() => rm(root, { recursive: true, force: true }));

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("GET /files/:key", () => {
  test("streams the object with content-type, content-length and no-store", async () => {
    const res = await app.request(`/files/${ws}/exports/lesson%201.pdf`, {
      headers: { [WORKSPACE_HEADER]: ws },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  test("another Workspace's key → 404 (not 403)", async () => {
    const res = await app.request(`/files/${foreignKey}`, { headers: { [WORKSPACE_HEADER]: ws } });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("not_found");
  });

  test("missing object in own Workspace → 404", async () => {
    const res = await app.request(`/files/${ws}/exports/nope.pdf`, {
      headers: { [WORKSPACE_HEADER]: ws },
    });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("not_found");
  });

  test("malformed key → 400 validation_failed", async () => {
    const res = await app.request("/files/not-a-key", { headers: { [WORKSPACE_HEADER]: ws } });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("validation_failed");
  });

  test("unauthenticated → 401", async () => {
    const res = await app.request(`/files/${key}`);
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("unauthorized");
  });

  test("no storage adapter → 503", async () => {
    const bare = createApp({ env: TEST_ENV, db: fakeSql(true), logger: silentLogger });
    const res = await bare.request(`/files/${key}`, { headers: { [WORKSPACE_HEADER]: ws } });
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("service_unavailable");
  });
});
