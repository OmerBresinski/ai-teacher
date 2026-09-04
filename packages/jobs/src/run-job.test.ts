import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { type JobId, newId, type WorkspaceId } from "@tj/domain";
import pino from "pino";
import type { BossJob } from "./run-job";
import { runJob } from "./run-job";
import { defineJob, type JobRegistry, type JobsContext } from "./types";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping runJob dependency injection test: ${t.reason}`);

describeDb("runJob dependencies", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, close } = t.db;
  let workspaceId: WorkspaceId;

  beforeEach(async () => {
    await t.db.truncateTenantTables();
    workspaceId = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId, workspaceName: "run job test" });
  });

  afterAll(async () => {
    await close();
  });

  test("passes RunJobOptions.deps to the selected handler", async () => {
    const deps = { marker: "injected" };
    let received: typeof deps | undefined;
    const registry: JobRegistry<typeof deps> = {
      ping: defineJob("ping", async () => {}),
      "ai.ping": defineJob<"ai.ping", typeof deps>("ai.ping", async ({ deps: injected }) => {
        received = injected;
      }),
    };
    const jobId = newId<JobId>();
    const boss = {
      findJobs: async () => [],
    } as unknown as JobsContext["boss"];
    const ctx: JobsContext = { boss, db: unsafeDb, sql };
    const job = {
      id: jobId,
      name: "ai.ping",
      data: {
        jobId,
        workspaceId,
        payload: { class: "small", prompt: "Reply with the single word: pong." },
      },
      retryCount: 0,
      retryLimit: 1,
      state: "active",
    } as unknown as BossJob<"ai.ping">;

    const outcome = await runJob(ctx, "ai.ping", registry, job, {
      deps,
      logger: pino({ level: "silent" }),
    });

    expect(received).toBe(deps);
    expect(outcome).toMatchObject({ status: "completed", event: "completed" });
  });
});
