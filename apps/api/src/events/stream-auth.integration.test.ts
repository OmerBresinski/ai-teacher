import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { insertJobEvent } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { type JobId, newId } from "@tj/domain";
import type { JobsContext } from "@tj/jobs";
import { Hono } from "hono";
import type { StreamAuthorization } from "../auth/stream-authorization";
import type { AppEnv } from "../context";
import { silentLogger } from "../test-helpers";
import { createEventsRuntime } from "./runtime";
import { streamJobEvents } from "./stream";

const t = await withTestDb({ max: 4 });
if (!t.ok) console.warn(`skipping SSE authorization integration: ${t.reason}`);
(t.ok ? describe : describe.skip)("SSE authorization cleanup against real scoped rows", () => {
  if (!t.ok) return;
  const db = t.db;
  afterAll(() => db.close());
  beforeEach(() => db.truncateTenantTables());

  test.each(["refused", "expired", "lookup-failure", "shutdown-race"] as const)(
    "%s ends the response and releases exactly once",
    async (mode) => {
      const { workspaceId } = await createTestUserWithWorkspace(db.unsafeDb);
      const foreign = await createTestUserWithWorkspace(db.unsafeDb);
      const jobId = newId() as JobId;
      await insertJobEvent(db.unsafeDb, {
        type: "started",
        workspaceId,
        jobId,
        at: new Date().toISOString(),
      });
      await insertJobEvent(db.unsafeDb, {
        type: "started",
        workspaceId: foreign.workspaceId,
        jobId: newId() as JobId,
        at: new Date().toISOString(),
      });
      let calls = 0;
      let releases = 0;
      const auth: StreamAuthorization = {
        kind: "session",
        sessionId: "synthetic-session",
        expiresAt: Date.now() + (mode === "expired" ? 80 : 10_000),
        revalidate: async () => {
          calls++;
          if (mode === "refused") return false;
          if (mode === "lookup-failure" && calls > 1) throw new Error("synthetic-private-error");
          return true;
        },
      };
      const runtime = createEventsRuntime({
        jobs: { db: db.unsafeDb } as JobsContext,
        logger: silentLogger,
        config: { heartbeatMs: 10, pollMs: 10 },
      });
      const controller = new AbortController();
      const app = new Hono<AppEnv>().get("/events", (c) => {
        const release = runtime.acquireStream(workspaceId);
        if (!release) throw new Error("No test slot");
        return streamJobEvents(c, runtime, {
          workspaceId,
          authorization: auth,
          authorizationTiming: { recheckMs: 20, maxAgeMs: 100 },
          closeOnTerminal: false,
          onClose: () => {
            releases++;
            release();
          },
        });
      });
      const timeout = setTimeout(() => controller.abort(), 1000);
      try {
        const response = await app.request("/events", { signal: controller.signal });
        const body = response.text();
        if (mode === "shutdown-race") {
          await runtime.stop();
          controller.abort();
        }
        const text = await body;
        expect(text).not.toContain(foreign.workspaceId);
        expect(text).not.toContain("synthetic-private-error");
        if (mode === "refused") expect(text).not.toContain("event: started");
        else if (mode !== "shutdown-race") expect(text).toContain("event: started");
        expect(releases).toBe(1);
        expect(runtime.openStreams(workspaceId)).toBe(0);
        expect(runtime.hub.size()).toBe(0);
        if (mode !== "shutdown-race") expect(controller.signal.aborted).toBe(false);
      } finally {
        clearTimeout(timeout);
        controller.abort();
        await runtime.stop();
      }
    },
  );
});
