import { describe, expect, test } from "bun:test";
import type { DbHandle } from "@tj/db";
import { newId, type WorkspaceId } from "@tj/domain";
import { createApp } from "../app";
import type { Auth } from "../auth/auth";
import { fakeSql, TEST_ENV } from "../test-helpers";

const workspaceId = newId<WorkspaceId>();

describe("GET /me", () => {
  test("returns the signed-in user and Workspace", async () => {
    const db = {
      sql: (async () => [{ id: workspaceId }]) as unknown as DbHandle["sql"],
    };
    const auth = {
      api: {
        getSession: async () => ({ user: { id: "user-1", email: "ada@example.com", name: "Ada" } }),
      },
    } as unknown as Auth;
    const app = createApp({ env: TEST_ENV, db, auth });

    const res = await app.request("/me");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: "user-1", email: "ada@example.com", name: "Ada" },
      workspaceId,
    });
  });

  test("requires a session", async () => {
    const app = createApp({ env: TEST_ENV, db: fakeSql(true) });
    const res = await app.request("/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });
});
