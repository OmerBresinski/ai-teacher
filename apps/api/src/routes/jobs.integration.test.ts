/**
 * Integration: `/jobs/*` and `/events` against TEST_DATABASE_URL with a real pg-boss
 * (schema `pgboss_test`) and an in-test worker loop mirroring `apps/worker` (ADR 0012).
 * Skips visibly when the database is unreachable.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, workspaces } from "@tj/db";
import { withTestDb } from "@tj/db/testing";
import { type JobEvent, type JobId, newId, type WorkspaceId } from "@tj/domain";
import {
  type BossJob,
  createBoss,
  defineJob,
  ensureQueues,
  type JobRegistry,
  type JobsContext,
  NonRetryableError,
  type RunJobOutcome,
  runJob,
} from "@tj/jobs";
import type { PgBoss } from "pg-boss";
import { createApp } from "../app";
import { createEventsRuntime, type EventsRuntime } from "../events/runtime";
import { silentLogger, TEST_ENV } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";

/**
 * This suite gets its own database, `<TEST_DATABASE_URL database>_api`, created on the fly from
 * `TEST_DATABASE_URL`. turbo runs `@tj/db`, `@tj/jobs` and `@tj/api` tests in parallel and the
 * sibling suites `TRUNCATE … CASCADE` the shared test database between tests, which would wipe
 * the Workspaces (and job events) this suite's worker loop is writing to mid-run.
 */
async function dedicatedTestDbUrl(suffix: string): Promise<string | undefined> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return undefined;
  const url = new URL(base);
  const name = `${url.pathname.slice(1)}${suffix}`;
  const admin = createDb(base, { max: 1 });
  try {
    const [row] = await admin.sql`select 1 from pg_database where datname = ${name}`;
    if (!row) await admin.sql.unsafe(`create database "${name}"`);
  } catch (err) {
    // Concurrent creation from another test file is fine; anything else surfaces in withTestDb.
    if (!(err instanceof Error && /already exists/.test(err.message))) throw err;
  } finally {
    await admin.close();
  }
  url.pathname = `/${name}`;
  return url.toString();
}

const dedicatedUrl = await dedicatedTestDbUrl("_api").catch(() => undefined);
if (dedicatedUrl) process.env.TEST_DATABASE_URL = dedicatedUrl;
const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping /jobs + /events integration tests: ${t.reason}`);

const STEP_MS = 300;

/** Same shape as `apps/worker/src/jobs/ping.ts` (apps may not import apps). */
const pingJob = defineJob("ping", async ({ payload, signal, progress }) => {
  for (let i = 1; i <= payload.steps; i++) {
    if (signal.aborted) return;
    await Bun.sleep(STEP_MS);
    if (signal.aborted) return;
    if (payload.failAt !== undefined && i === payload.failAt) {
      throw new NonRetryableError(`ping asked to fail at step ${i}/${payload.steps}`);
    }
    await progress(Math.round((i / payload.steps) * 100), `step ${i}/${payload.steps}`);
  }
});
const aiPingJob = defineJob("ai.ping", async () => {});

// --- a tiny SSE reader -----------------------------------------------------------------------

interface SseMessage {
  id?: string;
  event?: string;
  data: string;
}
interface SseComment {
  comment: string;
}
type SseItem = SseMessage | SseComment;

function parseBlock(block: string): SseItem | undefined {
  const msg: SseMessage = { data: "" };
  const data: string[] = [];
  let comment: string | undefined;
  for (const line of block.split("\n")) {
    if (line === "") continue;
    if (line.startsWith(":")) {
      comment = line.slice(1).trim();
      continue;
    }
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    const value = idx === -1 ? "" : line.slice(idx + 1).replace(/^ /, "");
    if (field === "data") data.push(value);
    else if (field === "event") msg.event = value;
    else if (field === "id") msg.id = value;
  }
  if (data.length > 0 || msg.event || msg.id) {
    msg.data = data.join("\n");
    return msg;
  }
  if (comment !== undefined) return { comment };
  return undefined;
}

/**
 * Read SSE items from `res` until the stream ends, `until(item)` returns true, or `timeoutMs`
 * passes. Cancels the body reader on the way out so the server sees the disconnect.
 */
async function readSse(
  res: Response,
  {
    until,
    timeoutMs = 10_000,
  }: { until?: (item: SseItem, all: SseItem[]) => boolean; timeoutMs?: number } = {},
): Promise<{ items: SseItem[]; ended: boolean }> {
  if (!res.body) throw new Error("no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const items: SseItem[] = [];
  let buffer = "";
  let ended = false;
  const deadline = Date.now() + timeoutMs;
  try {
    outer: while (Date.now() < deadline) {
      const left = deadline - Date.now();
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(left).then(() => ({ done: false, value: undefined, timeout: true }) as const),
      ]);
      if ("timeout" in chunk) break;
      if (chunk.done) {
        ended = true;
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const item = parseBlock(block);
        if (item) {
          items.push(item);
          if (until?.(item, items)) break outer;
        }
        sep = buffer.indexOf("\n\n");
      }
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => {});
  }
  return { items, ended };
}

const isMessage = (i: SseItem): i is SseMessage => "data" in i;
const types = (items: SseItem[]) => items.filter(isMessage).map((m) => m.event);

// --- suite ------------------------------------------------------------------------------------

describeDb("/jobs and /events against Postgres + pg-boss", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, close, url } = t.db;
  let boss: PgBoss;
  let jobsCtx: JobsContext;
  let runtime: EventsRuntime;
  let app: ReturnType<typeof createApp>;
  let workspaceA: WorkspaceId;
  let workspaceB: WorkspaceId;
  const shutdown = new AbortController();
  const registry: JobRegistry = { ping: pingJob, "ai.ping": aiPingJob };
  const controllers: AbortController[] = [];

  function headers(ws: WorkspaceId, extra: Record<string, string> = {}) {
    return { [WORKSPACE_HEADER]: ws, ...extra };
  }
  async function enqueuePing(ws: WorkspaceId, body: Record<string, unknown>) {
    const res = await app.request("/jobs/ping", {
      method: "POST",
      headers: headers(ws, { "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: JobId };
    return jobId;
  }
  function openStream(path: string, ws: WorkspaceId, extra: Record<string, string> = {}) {
    const ac = new AbortController();
    controllers.push(ac);
    return { res: app.request(path, { headers: headers(ws, extra), signal: ac.signal }), ac };
  }
  /**
   * `workspaces.owner_user_id` gains a FK to `users` with TEACH-20 (better-auth). The shared
   * compose test database may already carry that migration, so seed the owners when the table
   * exists; a no-op before it lands.
   */
  async function ensureOwnerUsers(ids: string[]) {
    const [row] = await sql<
      { exists: boolean }[]
    >`select to_regclass('public.users') is not null as exists`;
    if (!row?.exists) return;
    for (const id of ids) {
      await sql`insert into users (id, name, email, email_verified, created_at, updated_at)
        values (${id}, ${id}, ${`${id}@example.test`}, true, now(), now())
        on conflict (id) do nothing`;
    }
  }
  async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await pred()) return true;
      await Bun.sleep(20);
    }
    return pred();
  }

  beforeAll(async () => {
    boss = createBoss(url, { schema: "pgboss_test", max: 2, applicationName: "tj-api-test" });
    boss.on("error", (err) => console.error("pg-boss error", err));
    await boss.start();
    await ensureQueues(boss);
    jobsCtx = { boss, db: unsafeDb, sql };
    await boss.work(
      "ping",
      { batchSize: 1, includeMetadata: true, perJobResults: true, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        const results: RunJobOutcome[] = [];
        for (const job of jobs as BossJob[]) {
          results.push(
            await runJob(jobsCtx, "ping", registry, job, {
              shutdown: shutdown.signal,
              logger: silentLogger,
              deps: undefined,
            }),
          );
        }
        return results;
      },
    );
  });

  afterAll(async () => {
    // Remove what this file created (cascades to job_events; users only exist after TEACH-20).
    await sql`delete from workspaces where owner_user_id like ${"u-%"} and name in ('A','B')`;
    await sql`delete from users where id like ${"u-%"} and email like ${"%@example.test"}`.catch(
      () => {},
    );
    shutdown.abort();
    await boss.offWork("ping");
    await boss.stop({ graceful: false, close: true });
    await close();
  });

  // No `truncateTenantTables()` here: turbo runs `@tj/db`, `@tj/jobs` and this suite against the
  // same TEST_DATABASE_URL in parallel, and truncating `workspaces` cascades into a sibling's
  // in-flight job events. Every test uses fresh Workspace ids, so isolation comes for free.
  beforeEach(async () => {
    workspaceA = newId<WorkspaceId>();
    workspaceB = newId<WorkspaceId>();
    // Owner ids are unique per workspace once TEACH-20 lands; derive them from the workspace id.
    const ownerA = `u-${workspaceA}`;
    const ownerB = `u-${workspaceB}`;
    await ensureOwnerUsers([ownerA, ownerB]);
    await unsafeDb.insert(workspaces).values([
      { id: workspaceA, ownerUserId: ownerA, name: "A" },
      { id: workspaceB, ownerUserId: ownerB, name: "B" },
    ]);
    runtime = createEventsRuntime({
      jobs: jobsCtx,
      databaseUrl: url,
      logger: silentLogger,
      config: { heartbeatMs: 50, pollMs: 200, maxStreamsPerWorkspace: 2 },
    });
    app = createApp({
      env: TEST_ENV,
      db: t.db,
      logger: silentLogger,
      jobs: jobsCtx,
      events: runtime,
    });
  });

  afterEach(async () => {
    for (const ac of controllers.splice(0)) ac.abort();
    await runtime.stop();
  });

  test("POST /jobs/ai-ping stores the defaulted smoke payload", async () => {
    const res = await app.request("/jobs/ai-ping", {
      method: "POST",
      headers: headers(workspaceA, { "content-type": "application/json" }),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: JobId };
    const [row] = await boss.findJobs("ai.ping", { id: jobId });
    expect(row?.data).toEqual({
      jobId,
      workspaceId: workspaceA,
      payload: { class: "small", prompt: "Reply with the single word: pong." },
    });
    await boss.deleteJob("ai.ping", jobId);
  });

  test("(a) live stream: queued, started, progress×3, completed, then the stream ends", async () => {
    const jobId = await enqueuePing(workspaceA, { message: "hi", steps: 3 });
    const { res } = openStream(`/jobs/${jobId}/events`, workspaceA);
    const r = await res;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    expect(r.headers.get("cache-control")).toBe("no-cache");
    expect(r.headers.get("x-accel-buffering")).toBe("no");

    const { items, ended } = await readSse(r, { timeoutMs: 15_000 });
    expect(ended).toBe(true);
    expect(types(items)).toEqual([
      "queued",
      "started",
      "progress",
      "progress",
      "progress",
      "completed",
    ]);
    const messages = items.filter(isMessage);
    const ids = messages.map((m) => Number(m.id));
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    const first = JSON.parse(messages[0]?.data ?? "{}") as JobEvent;
    expect(first).toMatchObject({ type: "queued", jobId, workspaceId: workspaceA });
    // The stream went through LISTEN/NOTIFY, not the polling fallback.
    expect(runtime.hub.isDegraded()).toBe(false);
  }, 20_000);

  test("(b) connecting after completion replays everything and ends", async () => {
    const jobId = await enqueuePing(workspaceA, { message: "hi", steps: 1 });
    await waitFor(async () => {
      const [row] = await boss.findJobs("ping", { id: jobId });
      return row?.state === "completed";
    });
    const { res } = openStream(`/jobs/${jobId}/events`, workspaceA);
    const { items, ended } = await readSse(await res);
    expect(ended).toBe(true);
    expect(types(items)).toEqual(["queued", "started", "progress", "completed"]);
  }, 15_000);

  test("(c) Last-Event-ID replays only later events", async () => {
    const jobId = await enqueuePing(workspaceA, { message: "hi", steps: 1 });
    const first = await readSse(await openStream(`/jobs/${jobId}/events`, workspaceA).res);
    const started = first.items.filter(isMessage).find((m) => m.event === "started");
    if (!started?.id) throw new Error("no started event");
    const { res } = openStream(`/jobs/${jobId}/events`, workspaceA, {
      "Last-Event-ID": started.id,
    });
    const { items, ended } = await readSse(await res);
    expect(ended).toBe(true);
    expect(types(items)).toEqual(["progress", "completed"]);
    expect(Number(items.filter(isMessage)[0]?.id)).toBeGreaterThan(Number(started.id));
  }, 15_000);

  test("(c2) Last-Event-ID past the terminal row still closes a finished job's stream", async () => {
    const jobId = await enqueuePing(workspaceA, { message: "hi", steps: 1 });
    const first = await readSse(await openStream(`/jobs/${jobId}/events`, workspaceA).res);
    expect(first.ended).toBe(true);
    const { res } = openStream(`/jobs/${jobId}/events`, workspaceA, {
      "Last-Event-ID": "999999999",
    });
    const { items, ended } = await readSse(await res, { timeoutMs: 3_000 });
    expect(ended).toBe(true);
    expect(items.filter(isMessage)).toEqual([]);
  }, 15_000);

  test("(d) cancel mid-run ends the stream with `cancelled`", async () => {
    const jobId = await enqueuePing(workspaceA, { message: "hi", steps: 20 });
    const { res } = openStream(`/jobs/${jobId}/events`, workspaceA);
    const r = await res;
    // Read until `started`, keeping the stream open; then cancel over HTTP.
    const reader = readSse(r, {
      until: (_, all) => types(all).includes("cancelled"),
      timeoutMs: 15_000,
    });
    await waitFor(async () => {
      const [row] = await boss.findJobs("ping", { id: jobId });
      return row?.state === "active";
    });
    const cancelRes = await app.request(`/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: headers(workspaceA),
    });
    expect(cancelRes.status).toBe(202);
    expect(await cancelRes.json()).toEqual({ status: "cancelling" });

    const { items } = await reader;
    const seen = types(items);
    expect(seen[0]).toBe("queued");
    expect(seen[1]).toBe("started");
    expect(seen.at(-1)).toBe("cancelled");
    expect(seen).not.toContain("completed");
    // Cancelling again is reported, not repeated.
    const again = await app.request(`/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: headers(workspaceA),
    });
    expect(await again.json()).toEqual({ status: "already_finished" });
  }, 20_000);

  test("cancel of a queued job that never started → `cancelled` written by the API", async () => {
    await boss.offWork("ping");
    try {
      const jobId = await enqueuePing(workspaceA, { message: "hi", steps: 1 });
      const cancelRes = await app.request(`/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: headers(workspaceA),
      });
      expect(await cancelRes.json()).toEqual({ status: "cancelled" });
      const { items, ended } = await readSse(
        await openStream(`/jobs/${jobId}/events`, workspaceA).res,
      );
      expect(ended).toBe(true);
      expect(types(items)).toEqual(["queued", "cancelled"]);
    } finally {
      await boss.work(
        "ping",
        { batchSize: 1, includeMetadata: true, perJobResults: true, pollingIntervalSeconds: 0.5 },
        async (jobs) => {
          const results: RunJobOutcome[] = [];
          for (const job of jobs as BossJob[]) {
            results.push(
              await runJob(jobsCtx, "ping", registry, job, {
                shutdown: shutdown.signal,
                logger: silentLogger,
                deps: undefined,
              }),
            );
          }
          return results;
        },
      );
    }
  }, 15_000);

  test("(e) tenancy: workspace B gets 404 for A's job and never sees A's events", async () => {
    const firehoseB = openStream("/events", workspaceB);
    const rB = await firehoseB.res;
    expect(rB.status).toBe(200);
    const readB = readSse(rB, { timeoutMs: 1_500 });

    const jobId = await enqueuePing(workspaceA, { message: "hi", steps: 1 });
    const forbidden = await app.request(`/jobs/${jobId}/events`, { headers: headers(workspaceB) });
    expect(forbidden.status).toBe(404);
    expect(((await forbidden.json()) as { error: { code: string } }).error.code).toBe("not_found");
    const cancelForbidden = await app.request(`/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: headers(workspaceB),
    });
    expect(cancelForbidden.status).toBe(404);

    // A's own firehose sees the job; B's saw nothing in the same window.
    const readA = readSse(await openStream("/events", workspaceA).res, {
      until: (_, all) => types(all).includes("completed"),
      timeoutMs: 10_000,
    });
    const a = await readA;
    expect(types(a.items)).toEqual(["queued", "started", "progress", "completed"]);
    expect(a.ended).toBe(false); // the firehose never closes
    const b = await readB;
    expect(b.items.filter(isMessage)).toEqual([]);
  }, 20_000);

  test("(f) client disconnect releases the hub subscription and the stream slot", async () => {
    const { res, ac } = openStream("/events", workspaceA);
    const r = await res;
    const reader = r.body?.getReader();
    await waitFor(() => runtime.hub.size() === 1);
    expect(runtime.openStreams(workspaceA)).toBe(1);
    ac.abort();
    await reader?.cancel().catch(() => {});
    expect(await waitFor(() => runtime.hub.size() === 0)).toBe(true);
    expect(runtime.openStreams(workspaceA)).toBe(0);
  });

  test("(g) heartbeat comments arrive while a long step runs", async () => {
    const jobId = await enqueuePing(workspaceA, { message: "hi", steps: 2 });
    const { items } = await readSse(await openStream(`/jobs/${jobId}/events`, workspaceA).res, {
      until: (item) => "comment" in item,
      timeoutMs: 5_000,
    });
    expect(items.some((i) => "comment" in i && i.comment === "ping")).toBe(true);
  }, 10_000);

  test("stream limit per workspace → 429 rate_limited", async () => {
    const s1 = await openStream("/events", workspaceA).res;
    const s2 = await openStream("/events", workspaceA).res;
    expect(s1.status).toBe(200);
    expect(s2.status).toBe(200);
    const s3 = await app.request("/events", { headers: headers(workspaceA) });
    expect(s3.status).toBe(429);
    expect(((await s3.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    // Another workspace is unaffected.
    const sB = await openStream("/events", workspaceB).res;
    expect(sB.status).toBe(200);
  });

  test("degraded mode: without a listener the stream still delivers by polling", async () => {
    await runtime.stop();
    runtime = createEventsRuntime({
      jobs: jobsCtx,
      logger: silentLogger,
      config: { heartbeatMs: 50, pollMs: 100 },
    });
    expect(runtime.hub.isDegraded()).toBe(true);
    app = createApp({
      env: TEST_ENV,
      db: t.db,
      logger: silentLogger,
      jobs: jobsCtx,
      events: runtime,
    });
    const jobId = await enqueuePing(workspaceA, { message: "hi", steps: 2 });
    const { items, ended } = await readSse(
      await openStream(`/jobs/${jobId}/events`, workspaceA).res,
      {
        timeoutMs: 10_000,
      },
    );
    expect(ended).toBe(true);
    expect(types(items)).toEqual(["queued", "started", "progress", "progress", "completed"]);
  }, 15_000);
});
