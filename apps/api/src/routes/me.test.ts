import { describe, expect, test } from "bun:test";
import type { DbHandle } from "@tj/db";
import { newId, type WorkspaceId } from "@tj/domain";
import { createApp } from "../app";
import type { Auth } from "../auth/auth";
import { fakeSql, TEST_ENV, unreachableDb } from "../test-helpers";

const workspaceId = newId<WorkspaceId>();

describe("GET /me", () => {
  function appWithSessionUser(user: Record<string, unknown>) {
    const db = {
      sql: (async () => [{ id: workspaceId }]) as unknown as DbHandle["sql"],
      unsafeDb: unreachableDb,
    };
    const auth = {
      api: {
        getSession: async (options: { query?: { disableCookieCache?: boolean } }) => {
          expect(options.query?.disableCookieCache).toBe(true);
          return {
            user,
            session: { id: "session-1", expiresAt: new Date(Date.now() + 60_000) },
          };
        },
      },
    } as unknown as Auth;
    return createApp({ env: TEST_ENV, db, auth });
  }

  test("returns the signed-in user and Workspace", async () => {
    const app = appWithSessionUser({
      id: "user-1",
      email: "ada@example.com",
      name: "Ada",
      isAnonymous: false,
    });

    const res = await app.request("/me");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: "user-1", email: "ada@example.com", name: "Ada", isAnonymous: false },
      workspaceId,
    });
  });

  test("isAnonymous is true only for an anonymous user; a missing flag reads false (TEACH-223)", async () => {
    const anon = appWithSessionUser({
      id: "u-anon",
      email: "x@y.invalid",
      name: "",
      isAnonymous: true,
    });
    expect(
      ((await (await anon.request("/me")).json()) as { user: { isAnonymous: boolean } }).user
        .isAnonymous,
    ).toBe(true);
    for (const isAnonymous of [null, undefined]) {
      const app = appWithSessionUser({ id: "u-1", email: "a@b.test", name: "A", isAnonymous });
      expect(
        ((await (await app.request("/me")).json()) as { user: { isAnonymous: boolean } }).user
          .isAnonymous,
      ).toBe(false);
    }
  });

  test("requires a session", async () => {
    const app = createApp({ env: TEST_ENV, db: fakeSql(true) });
    const res = await app.request("/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });
});
