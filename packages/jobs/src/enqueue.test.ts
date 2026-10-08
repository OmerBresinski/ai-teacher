import { describe, expect, mock, test } from "bun:test";
import { type JobId, newId, type WorkspaceId } from "@tj/domain";
import type { PgBoss } from "pg-boss";
import { ZodError } from "zod";
import { enqueue } from "./enqueue";
import type { JobsContext } from "./types";

/**
 * A boss whose `send` echoes the requested id, and db/sql stubs that throw if touched. `sql.begin`
 * runs the transaction body on a connection whose queries throw "db touched", so the `queued`
 * insert (after `send`) fails loudly and rolls the transaction back.
 */
function fakeCtx() {
  const send = mock(async (_name: string, _data: object, opts: { id: string }) => opts.id);
  const cancel = mock(async (_name: string, _id: string) => {});
  const boss = { send, cancel } as unknown as PgBoss;
  const db = new Proxy({}, { get: () => () => fail("db touched") }) as JobsContext["db"];
  const connection = { unsafe: () => fail("db touched") };
  const sql = Object.assign(() => fail("sql touched"), {
    begin: async (body: (tx: unknown) => Promise<unknown>) => body(connection),
    options: { parsers: {}, serializers: {} },
  }) as unknown as JobsContext["sql"];
  return { ctx: { boss, db, sql } satisfies JobsContext, send, cancel };
}
function fail(msg: string): never {
  throw new Error(msg);
}

describe("enqueue", () => {
  const workspaceId = newId<WorkspaceId>();

  test("rejects an invalid payload before touching pg-boss", async () => {
    const { ctx, send } = fakeCtx();
    await expect(
      // @ts-expect-error message must be a string
      enqueue(ctx, "ping", { message: 42 }, { workspaceId }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(send).not.toHaveBeenCalled();
  });

  test("rejects unknown fields (strict payloads) before touching pg-boss", async () => {
    const { ctx, send } = fakeCtx();
    await expect(
      // @ts-expect-error unknown field
      enqueue(ctx, "ping", { message: "hi", extra: true }, { workspaceId }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(send).not.toHaveBeenCalled();
  });

  test("rejects an unknown job name before touching pg-boss", async () => {
    const { ctx, send } = fakeCtx();
    await expect(
      // @ts-expect-error not a JobName
      enqueue(ctx, "nope", { message: "hi" }, { workspaceId }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(send).not.toHaveBeenCalled();
  });

  test("sends the parsed payload (defaults applied) under the minted job id", async () => {
    const { ctx, send } = fakeCtx();
    // The `queued` insert happens after `send`, in the same transaction; with the throwing stub it
    // fails loudly, which is enough to assert the pg-boss call shape here (the DB path is covered
    // by integration tests).
    await expect(enqueue(ctx, "ping", { message: "hi" }, { workspaceId })).rejects.toThrow(
      'insert into "job_events"',
    );
    expect(send).toHaveBeenCalledTimes(1);
    const [name, data, opts] = send.mock.calls[0] as unknown as [
      string,
      { jobId: string; workspaceId: string; payload: unknown },
      { id: string; retryLimit: number; singletonKey?: string },
    ];
    expect(name).toBe("ping");
    expect(data.payload).toEqual({ message: "hi", steps: 5 });
    expect(data.workspaceId).toBe(workspaceId);
    expect(opts.id).toBe(data.jobId);
    expect(opts.retryLimit).toBe(1);
    expect(opts.singletonKey).toBeUndefined();
  });

  test("sends with the transaction as its executor and never cancels on a failed queued insert", async () => {
    const { ctx, send, cancel } = fakeCtx();
    await expect(enqueue(ctx, "ping", { message: "hi" }, { workspaceId })).rejects.toThrow(
      'insert into "job_events"',
    );
    const opts = (send.mock.calls[0] as unknown as [string, object, { db?: unknown }])[2];
    expect(typeof (opts.db as { executeSql?: unknown } | undefined)?.executeSql).toBe("function");
    expect(cancel).not.toHaveBeenCalled();
  });

  test("uses the caller's job id when one is supplied", async () => {
    const { ctx, send } = fakeCtx();
    const id = newId<JobId>();
    await expect(enqueue(ctx, "ping", { message: "hi" }, { workspaceId, id })).rejects.toThrow(
      'insert into "job_events"',
    );
    const [, data, opts] = send.mock.calls[0] as unknown as [
      string,
      { jobId: string },
      { id: string },
    ];
    expect(opts.id).toBe(id);
    expect(data.jobId).toBe(id);
  });

  test("returns null (and writes no event) when singletonKey deduplicates the send", async () => {
    const { ctx } = fakeCtx();
    (ctx.boss as unknown as { send: unknown }).send = mock(async () => null);
    const result = await enqueue(
      ctx,
      "ping",
      { message: "hi" },
      { workspaceId, singletonKey: "k" },
    );
    expect(result).toBeNull();
  });
});
