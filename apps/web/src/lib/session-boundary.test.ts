import { afterAll, describe, expect, test } from "bun:test";
import type { MutationFunctionContext, UseMutationOptions } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import { installFakeApi } from "@/test/fake-api";
import { libraryMutations, libraryQueries } from "./library";
import { queryKeys } from "./query";
import {
  SessionBoundary,
  SessionChangedError,
  SIGN_OUT_FAILED,
  sessionRequest,
} from "./session-boundary";

const { fakeApi, restore } = installFakeApi();
afterAll(restore);
const context = {} as MutationFunctionContext;
function run<T, V, C>(options: UseMutationOptions<T, Error, V, C>, variables: V) {
  if (!options.mutationFn) throw new Error("Missing mutation");
  return options.mutationFn(variables, context);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("session boundary", () => {
  test("logout replaces the client, cancels requests and removes private state", async () => {
    const boundary = new SessionBoundary();
    const a = boundary.getSnapshot().client;
    a.setQueryData(queryKeys.libraryDocument("a"), { private: "A body" });
    a.setQueryData(queryKeys.libraryDocumentMeta("a"), { private: "A metadata" });
    a.setQueryData(queryKeys.job("job"), { private: "A proposal" });
    localStorage.setItem("tj-theme", "dark");
    const signal = sessionRequest(a).init.signal;
    await boundary.signOut(async () => ({}));
    expect(signal.aborted).toBe(true);
    expect(boundary.getSnapshot().client).not.toBe(a);
    expect(a.getQueryCache().getAll()).toHaveLength(0);
    expect(boundary.getSnapshot().client.getQueryCache().getAll()).toHaveLength(0);
    // A detached continuation cannot resurrect a private entry on the retired client either.
    a.setQueryData(queryKeys.libraryDocument("a"), { private: "late A" });
    expect(a.getQueryCache().getAll()).toHaveLength(0);
    expect(localStorage.getItem("tj-theme")).toBe("dark");
  });

  test("identity changes and remote logout clear the boundary without rebroadcast loops", () => {
    const boundary = new SessionBoundary();
    const announcements: unknown[] = [];
    boundary.announce = (value) => announcements.push(value);
    const a = boundary.getSnapshot().client;
    boundary.confirm(a, "user-a:workspace-a");
    a.setQueryData(["private"], "A");
    boundary.receive({ identity: "user-b:workspace-b" });
    expect(a.getQueryCache().getAll()).toHaveLength(0);
    const b = boundary.getSnapshot().client;
    expect(b).not.toBe(a);
    expect(boundary.getSnapshot().identity).toBeUndefined();
    expect(() => boundary.confirm(a, "user-a:workspace-a")).toThrow(SessionChangedError);
    boundary.receive({ identity: null });
    expect(boundary.getSnapshot().identity).toBeUndefined();
    expect(announcements).toEqual([{ identity: "user-a:workspace-a" }]);
  });

  test("a forged identity notification cannot establish an authenticated identity", () => {
    const boundary = new SessionBoundary();
    boundary.confirm(boundary.getSnapshot().client, "real-user:real-workspace");
    boundary.receive({ identity: "forged-user:forged-workspace" });
    expect(boundary.getSnapshot().identity).toBeUndefined();
    // Only the actual /me result confirms identity on the fresh client.
    boundary.confirm(boundary.getSnapshot().client, "real-user:real-workspace");
    expect(boundary.getSnapshot().identity).toBe("real-user:real-workspace");
  });

  test("signOut error is explicit and does not restore cached data", async () => {
    const boundary = new SessionBoundary();
    const a = boundary.getSnapshot().client;
    a.setQueryData(["private"], "A");
    await boundary.signOut(async () => ({ error: { message: "provider detail" } }));
    expect(boundary.getSnapshot().notice).toBe(SIGN_OUT_FAILED);
    expect(boundary.getSnapshot().locked).toBe(true);
    expect(a.getQueryCache().getAll()).toHaveLength(0);
  });

  test("a late non-abortable Document response cannot repopulate either client", async () => {
    fakeApi.reset();
    const boundary = new SessionBoundary();
    const a = boundary.getSnapshot().client;
    const transport = globalThis.fetch;
    const started = deferred<void>();
    const reply = deferred<void>();
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const response = await transport(...args);
      started.resolve();
      await reply.promise;
      return response;
    }) as typeof fetch;
    try {
      const pending = a
        .fetchQuery(libraryQueries.document("demo-water-cycle"))
        .catch(() => undefined);
      await started.promise;
      boundary.reset("user-b:workspace-b");
      reply.resolve();
      await pending;
      expect(a.getQueryCache().getAll()).toHaveLength(0);
      expect(boundary.getSnapshot().client.getQueryCache().getAll()).toHaveLength(0);
    } finally {
      globalThis.fetch = transport;
    }
  });

  test("late autosave is discarded; an old multi-step copy never POSTs under B", async () => {
    fakeApi.reset();
    for (const operation of ["save", "copy"] as const) {
      const boundary = new SessionBoundary();
      const a = boundary.getSnapshot().client;
      const row = fakeApi.rows.get("demo-water-cycle");
      if (!row) throw new Error("Missing fixture");
      const document = { ...row.body, id: row.id } as Lesson;
      a.setQueryData(queryKeys.libraryDocumentMeta(row.id), { updatedAt: row.updatedAt });
      const transport = globalThis.fetch;
      const started = deferred<void>();
      const reply = deferred<void>();
      globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        const response = await transport(...args);
        started.resolve();
        await reply.promise;
        return response;
      }) as typeof fetch;
      try {
        const pending = (
          operation === "save"
            ? run(libraryMutations.autosaveDocument(a), document)
            : run(libraryMutations.duplicateDocument(a), [row.id] as [string])
        ).catch((error: unknown) => error);
        await started.promise;
        boundary.reset("user-b:workspace-b");
        reply.resolve();
        expect(await pending).toBeInstanceOf(SessionChangedError);
        expect(a.getQueryCache().getAll()).toHaveLength(0);
        expect(fakeApi.requests.filter((request) => request.method === "POST")).toHaveLength(0);
      } finally {
        globalThis.fetch = transport;
      }
    }
  });
});
