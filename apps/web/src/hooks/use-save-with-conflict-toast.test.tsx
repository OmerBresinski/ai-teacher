import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { SaveRefusedError } from "@tj/editor/autosave";
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
function setup(onStale: () => Promise<LibraryDocument | undefined>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const row = fakeApi.get(ID);
  if (!row) throw new Error("fake api has no demo lesson");
  const meta: DocumentMeta = {
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    generatingJobId: row.generatingJobId,
  };
  queryClient.setQueryData(queryKeys.libraryDocumentMeta(ID), meta);
  fakeApi.touch(ID);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSaveWithConflictToast(ID, onStale), { wrapper });
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
