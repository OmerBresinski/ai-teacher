import { afterAll, expect, mock, test } from "bun:test";
import type { MutationFunctionContext } from "@tanstack/react-query";
import type { Proposal } from "@tj/domain";
import type { Worksheet } from "@tj/domain/documents";
import { libraryMutations } from "@/lib/library";
import { SessionBoundary } from "@/lib/session-boundary";
import { installFakeApi } from "@/test/fake-api";
import { applyToWorksheet } from "./use-proposal-jobs";

const { fakeApi, restore } = installFakeApi();
afterAll(restore);

test("terminal worksheet proposals cannot start a save after the session changes during fetch", async () => {
  fakeApi.reset();
  const row = [...fakeApi.rows.values()].find((row) => row.kind === "worksheet");
  if (!row) throw new Error("Missing worksheet fixture");
  const boundary = new SessionBoundary();
  const client = boundary.getSnapshot().client;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const request = new Promise<void>((resolve) => {
    started = resolve;
  });
  const transport = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const response = await transport(...args);
    started();
    await hold;
    return response;
  }) as typeof fetch;
  const save = mock(async (_worksheet: Worksheet) => {});
  try {
    const pending = applyToWorksheet(client, row.id, [], save);
    await request;
    boundary.reset("B");
    release();
    await pending;
    expect(save).not.toHaveBeenCalled();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  } finally {
    release();
    globalThis.fetch = transport;
  }
});

test("a worksheet save already in flight cannot repopulate metadata after the transition", async () => {
  fakeApi.reset();
  const row = [...fakeApi.rows.values()].find((row) => row.kind === "worksheet");
  if (!row) throw new Error("Missing worksheet fixture");
  const worksheet = row.body as Worksheet;
  const block = worksheet.blocks[0];
  if (!block) throw new Error("Missing block fixture");
  const proposal: Proposal = {
    target: { blockId: block.id },
    block: { ...block, id: "replacement" },
    generatedFrom: {
      factRefs: [],
      promptVersion: "test",
      model: "fake",
      at: "2026-09-13T00:00:00Z",
    },
  };
  const boundary = new SessionBoundary();
  const client = boundary.getSnapshot().client;
  const save = libraryMutations.saveDocument(client).mutationFn;
  if (!save) throw new Error("Missing save mutation");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const request = new Promise<void>((resolve) => {
    started = resolve;
  });
  const transport = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const response = await transport(...args);
    if (args[1]?.method === "PUT") {
      started();
      await hold;
    }
    return response;
  }) as typeof fetch;
  try {
    const pending = applyToWorksheet(client, row.id, [proposal], (next) =>
      save(next, {} as MutationFunctionContext),
    );
    await request;
    boundary.reset("B");
    release();
    await pending;
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(boundary.getSnapshot().client.getQueryCache().getAll()).toHaveLength(0);
  } finally {
    release();
    globalThis.fetch = transport;
  }
});
