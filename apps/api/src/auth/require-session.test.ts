import { describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "@tj/domain";
import { createApp } from "../app";
import { fakeSql, silentLogger, TEST_ENV, TEST_ENV_NO_SHIM } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";

const workspaceId = newId<WorkspaceId>();
const workspaceHeader = { [WORKSPACE_HEADER]: workspaceId };

function appWithHeaderShim(allowHeaderShim: boolean) {
  return createApp({
    env: allowHeaderShim ? TEST_ENV : TEST_ENV_NO_SHIM,
    db: fakeSql(true),
    logger: silentLogger,
  });
}

describe("requireSession workspace header shim", () => {
  test("does not inspect the header when the shim is disabled", async () => {
    const app = appWithHeaderShim(false);

    const me = await app.request("/me", { headers: workspaceHeader });
    expect(me.status).toBe(401);
    expect(await me.json()).toMatchObject({ error: { code: "unauthorized" } });

    const ping = await app.request("/jobs/ping", {
      method: "POST",
      headers: { ...workspaceHeader, "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(ping.status).toBe(401);

    const malformed = await app.request("/me", { headers: { [WORKSPACE_HEADER]: "nope" } });
    expect(malformed.status).toBe(401);
    expect(await malformed.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  test("accepts the header only when the shim is enabled", async () => {
    const app = appWithHeaderShim(true);

    // The shim selects a Workspace but does not create a user, so /me remains unauthorized.
    const me = await app.request("/me", { headers: workspaceHeader });
    expect(me.status).toBe(401);

    const ping = await app.request("/jobs/ping", {
      method: "POST",
      headers: { ...workspaceHeader, "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(ping.status).toBe(503);
  });
});
