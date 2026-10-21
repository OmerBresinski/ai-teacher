import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { SaveDeferredError, SaveRefusedError } from "@tj/editor/autosave";
import type { ReactNode } from "react";
import type { DocumentMeta, LibraryDocument } from "@/lib/library";
import { queryKeys } from "@/lib/query";
import { installFakeApi } from "@/test/fake-api";

const { fakeApi, restore: restoreFetch } = installFakeApi();

const actualUi = await import("@tj/ui");
const toastSpy = Object.assign(mock(), { error: mock(), dismiss: mock() });
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

const { RELOAD_LABEL, useSaveWithConflictToast } = await import("./use-save-with-conflict-toast");

afterAll(() => {
  mock.restore();
  restoreFetch();
});

const ID = "demo-water-cycle";

const puts = () =>
  fakeApi.requests.filter((r) => r.method === "PUT" && r.path === `/documents/${ID}`).length;

/** A hook whose cached row state is the stored one, then another writer moves the row on. */
function setup(
  onStale: () => Promise<LibraryDocument | undefined>,
  lock?: { holder: string | null; following?: string },
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const row = fakeApi.get(ID);
  if (!row) throw new Error("fake api has no demo lesson");
  const meta: DocumentMeta = {
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    generatingJobId: lock ? lock.holder : row.generatingJobId,
  };
  if (lock) fakeApi.setGenerating(ID, lock.holder);
  queryClient.setQueryData(queryKeys.libraryDocumentMeta(ID), meta);
  // Another writer moves the row on (with a lock held, the lock refuses the save instead).
  if (!lock?.holder) fakeApi.touch(ID);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => useSaveWithConflictToast(ID, onStale, lock ? () => lock.following : undefined),
    { wrapper },
  );
  const body = row.body as LibraryDocument;
  /** The save's rejection (or `undefined`), with React's state updates flushed. */
  const refusal = async (document: LibraryDocument) => {
    let caught: unknown;
    await act(async () => {
      caught = await result.current(document).then(
        () => undefined,
        (error: unknown) => error,
      );
    });
    return caught;
  };
  return { refusal, body };
}

describe("useSaveWithConflictToast with onStale", () => {
  beforeEach(() => toastSpy.mockReset());

  it("a second stale 409 on the merged retry still toasts Reload and rejects as refused", async () => {
    const before = puts();
    // The job writes again between the pull and the retry, so the merged save is stale too.
    const { refusal, body } = setup(async () => {
      fakeApi.touch(ID);
      return body;
    });
    expect(await refusal(body)).toBeInstanceOf(SaveRefusedError);
    expect(puts() - before).toBe(2);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    const [, options] = toastSpy.mock.calls[0] as [string, { action?: { label: string } }];
    expect(options.action?.label).toBe(RELOAD_LABEL);
  });

  it("no merged copy falls through to the toast", async () => {
    const { refusal, body } = setup(async () => undefined);
    expect(await refusal(body)).toBeInstanceOf(SaveRefusedError);
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });
});

describe("useSaveWithConflictToast under a generating lock (ADR 0039)", () => {
  beforeEach(() => toastSpy.mockReset());
  afterAll(() => fakeApi.setGenerating(ID, null));
  const JOB = "01a06a15-1849-7000-ac6a-c07e27fe3001";
  const OTHER = "01a06a15-1849-7000-ac6a-c07e27fe3002";

  it("the lesson's own streaming job holding the lock: deferred quietly, no toast", async () => {
    const { refusal, body } = setup(async () => undefined, { holder: JOB, following: JOB });
    expect(await refusal(body)).toBeInstanceOf(SaveDeferredError);
    expect(toastSpy).toHaveBeenCalledTimes(0);
  });

  it("UX-A: just after the followed job ends, a save its last write beat is deferred, not toasted", async () => {
    const before = puts();
    // The slow-network race: the job's write lands between the pull and the merged retry.
    const { refusal, body } = setup(
      async () => {
        fakeApi.touch(ID);
        return body;
      },
      { holder: null, following: JOB },
    );
    expect(await refusal(body)).toBeInstanceOf(SaveDeferredError);
    expect(puts() - before).toBe(2);
    expect(toastSpy).toHaveBeenCalledTimes(0);
  });

  it("another job's lock still shows the toast", async () => {
    const { refusal, body } = setup(async () => undefined, { holder: OTHER, following: JOB });
    expect(await refusal(body)).toBeInstanceOf(SaveRefusedError);
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it("a lock while the editor follows no job still shows the toast", async () => {
    const { refusal, body } = setup(async () => undefined, { holder: OTHER });
    expect(await refusal(body)).toBeInstanceOf(SaveRefusedError);
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });
});
