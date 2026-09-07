import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  type MutationFunctionContext,
  QueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import type { DocumentSummary, Lesson } from "@tj/domain/documents";
import { installFakeApi } from "@/test/fake-api";
import {
  libraryCache,
  libraryMutations,
  libraryQueries,
  librarySelectors,
  type SeriesWithLessons,
  sortDocuments,
} from "./library";
import { ApiError, queryKeys } from "./query";

const { fakeApi, restore } = installFakeApi();
afterAll(restore);
beforeEach(() => fakeApi.reset());

async function invokeOnSuccess<TData, TVariables>(
  onSuccess: UseMutationOptions<TData, Error, TVariables>["onSuccess"],
): Promise<void> {
  if (!onSuccess) throw new Error("Expected mutation onSuccess callback");
  await onSuccess(
    undefined as TData,
    undefined as TVariables,
    undefined,
    {} as MutationFunctionContext,
  );
}

/** Run a mutation's `mutationFn` outside React. */
function run<TData, TVariables, TContext>(
  options: UseMutationOptions<TData, Error, TVariables, TContext>,
  variables: NoInfer<TVariables>,
): Promise<TData> {
  if (!options.mutationFn) throw new Error("Expected mutationFn");
  return options.mutationFn(variables, {} as MutationFunctionContext);
}

/** Drive a mutation the way `useMutation` does: `onMutate`, then the write, then `onError`/`onSettled`. */
async function mutate<TData, TVariables, TContext>(
  options: UseMutationOptions<TData, Error, TVariables, TContext>,
  variables: NoInfer<TVariables>,
): Promise<{ result?: TData; error?: unknown }> {
  const ctx = {} as MutationFunctionContext;
  const onMutateResult = (await options.onMutate?.(variables, ctx)) as TContext | undefined;
  try {
    const result = await run(options, variables);
    await options.onSettled?.(result, null, variables, onMutateResult, ctx);
    return { result };
  } catch (error) {
    await options.onError?.(error as Error, variables, onMutateResult, ctx);
    await options.onSettled?.(undefined, error as Error, variables, onMutateResult, ctx);
    return { error };
  }
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function summary(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: "doc",
    kind: "lesson",
    title: "Untitled",
    itemCount: 6,
    themeId: "chalk",
    cover: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    ...overrides,
  };
}

const lastRequest = () => fakeApi.requests.at(-1);

describe("library queries", () => {
  it("keys lists by kind, sort and search under the library family", () => {
    expect<readonly unknown[]>(libraryQueries.documents("lesson").queryKey).toEqual([
      ...queryKeys.libraryDocuments,
      "lesson",
      "edited",
      "",
    ]);
    expect<readonly unknown[]>(
      libraryQueries.documents("worksheet", { sort: "title", q: " frac " }).queryKey,
    ).toEqual([...queryKeys.libraryDocuments, "worksheet", "title", "frac"]);
    expect<readonly unknown[]>(libraryQueries.series().queryKey).toEqual([
      ...queryKeys.librarySeries,
      "edited",
      "",
    ]);
    expect<readonly unknown[]>(libraryQueries.seriesDetail("s1").queryKey).toEqual(
      queryKeys.librarySeriesDetail("s1"),
    );
    expect<readonly unknown[]>(libraryQueries.document("d1").queryKey).toEqual(
      queryKeys.libraryDocument("d1"),
    );
    expect<readonly unknown[]>(libraryQueries.documentMeta("d1").queryKey).toEqual(
      queryKeys.libraryDocumentMeta("d1"),
    );
  });

  it("asks the server for one kind, sorted and searched, 100 at a time", async () => {
    const queryClient = newClient();
    const data = await queryClient.fetchInfiniteQuery(
      libraryQueries.documents("lesson", { sort: "title", q: "roman" }),
    );
    const request = lastRequest();
    expect(request?.path).toBe("/documents");
    expect(Object.fromEntries(request?.query ?? [])).toEqual({
      kind: "lesson",
      sort: "title",
      q: "roman",
      limit: "100",
    });
    expect(librarySelectors.items(data).map((d) => d.title)).toEqual([
      "Life in the Roman army",
      "Roman roads",
      "The Roman Empire",
    ]);
    expect(librarySelectors.count(data)).toBe(3);
  });

  it("pages through nextCursor without duplicates", async () => {
    const queryClient = newClient();
    const water = fakeApi.get("demo-water-cycle");
    if (!water) throw new Error("fixture missing");
    for (let i = 0; i < 140; i += 1) {
      const id = `bulk-${String(i).padStart(3, "0")}`;
      fakeApi.rows.set(id, {
        ...water,
        id,
        body: { ...water.body, id, title: `Bulk lesson ${i}` },
        updatedAt: new Date(Date.UTC(2020, 0, 1, 0, i)).toISOString(),
      });
    }
    const options = libraryQueries.documents("lesson");
    const first = await queryClient.fetchInfiniteQuery(options);
    expect(first.pages).toHaveLength(1);
    expect(first.pages[0]?.items).toHaveLength(100);
    expect(first.pages[0]?.nextCursor).not.toBeNull();

    const both = await queryClient.fetchInfiniteQuery({ ...options, pages: 2 });
    const ids = librarySelectors.items(both).map((d) => d.id);
    expect(ids).toHaveLength(150);
    expect(new Set(ids).size).toBe(150);
    expect(Object.fromEntries(lastRequest()?.query ?? [])).toMatchObject({ cursor: "100" });
    expect(both.pages[1]?.nextCursor).toBeNull();
  });

  it("resolves a document body and stores its row state beside it", async () => {
    const queryClient = newClient();
    const body = await queryClient.fetchQuery(libraryQueries.document("demo-water-cycle"));
    expect(body && "slides" in body && body.title).toBe("The water cycle");
    const meta = queryClient.getQueryData(queryKeys.libraryDocumentMeta("demo-water-cycle"));
    expect(meta).toEqual({
      createdAt: fakeApi.get("demo-water-cycle")?.createdAt,
      updatedAt: fakeApi.get("demo-water-cycle")?.updatedAt,
      deletedAt: null,
      generatingJobId: null,
    });
    expect(await queryClient.fetchQuery(libraryQueries.document("nope"))).toBeNull();
  });

  it("a deleted or series id resolves to null on the document routes", async () => {
    const queryClient = newClient();
    await run(libraryMutations.softDeleteDocument(queryClient), "demo-water-cycle");
    expect(await queryClient.fetchQuery(libraryQueries.document("demo-water-cycle"))).toBeNull();
    expect(await queryClient.fetchQuery(libraryQueries.document("series-romans"))).toBeNull();
  });

  it("the series list carries each series' lessons in teaching order", async () => {
    const queryClient = newClient();
    const data = await queryClient.fetchInfiniteQuery(libraryQueries.series());
    const romans = librarySelectors.items(data).find((item) => item.series.id === "series-romans");
    expect(romans?.lessons.map((lesson) => lesson.title)).toEqual([
      "Roman roads",
      "Fractions of amounts",
      "Life in the Roman army",
    ]);
    const detail = await queryClient.fetchQuery(libraryQueries.seriesDetail("series-romans"));
    expect(detail?.series.lessonIds).toEqual(["roman-roads", "demo-fractions", "roman-army"]);
    expect(await queryClient.fetchQuery(libraryQueries.seriesDetail("nope"))).toBeNull();
  });

  it("seeds detail placeholders from the cached lists so navigation paints instantly", async () => {
    const queryClient = newClient();
    await queryClient.fetchInfiniteQuery(libraryQueries.documents("lesson"));
    await queryClient.fetchInfiniteQuery(libraryQueries.series());
    const placeholder = <T>(options: { placeholderData?: unknown }) =>
      (options.placeholderData as () => T)();

    expect(libraryCache.document(queryClient, "demo-water-cycle")?.title).toBe("The water cycle");
    expect(
      placeholder<DocumentSummary>(libraryQueries.document("demo-water-cycle", queryClient)).title,
    ).toBe("The water cycle");
    expect(
      placeholder<SeriesWithLessons>(libraryQueries.seriesDetail("series-romans", queryClient))
        .series.title,
    ).toBe("The Romans");
    expect(placeholder(libraryQueries.document("missing", queryClient))).toBeUndefined();
    expect(placeholder(libraryQueries.document("demo-water-cycle"))).toBeUndefined();
    expect(libraryCache.seriesDetail(queryClient, "nope")).toBeUndefined();
  });
});

describe("library mutations", () => {
  it("createDocument posts a starter body and returns the server's summary", async () => {
    const queryClient = newClient();
    const created = await run(libraryMutations.createDocument(queryClient), {
      kind: "lesson",
      title: "  Volcanoes ",
      themeId: "beacon",
      yearGroup: "Year 5",
    });
    expect(lastRequest()?.method).toBe("POST");
    expect(lastRequest()?.path).toBe("/documents");
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.title).toBe("Volcanoes");
    expect(created.yearGroup).toBe("Year 5");
    expect(created.itemCount).toBeGreaterThan(0);
    const blank = await run(libraryMutations.createDocument(queryClient), {
      kind: "worksheet",
      title: "Sheet",
      themeId: "chalk",
      start: "blank",
    });
    expect(blank.kind).toBe("worksheet");
  });

  it("rename and save PUT the whole document with the row's expectedUpdatedAt", async () => {
    const queryClient = newClient();
    const before = fakeApi.get("demo-water-cycle")?.updatedAt;
    expect(
      await run(libraryMutations.renameDocument(queryClient), ["demo-water-cycle", " Rain "]),
    ).toBe(true);
    const put = lastRequest();
    expect(put?.method).toBe("PUT");
    expect(put?.body).toMatchObject({ expectedUpdatedAt: before });
    expect(fakeApi.get("demo-water-cycle")?.body.title).toBe("Rain");
    expect(
      await run(libraryMutations.renameDocument(queryClient), ["demo-water-cycle", "  "]),
    ).toBe(false);

    // A save with no cached row state reads it first, then sends the token it was given.
    const body = fakeApi.loadDocument("demo-water-cycle") as Lesson;
    await run(libraryMutations.autosaveDocument(queryClient), { ...body, title: "Rivers" });
    expect(fakeApi.get("demo-water-cycle")?.body.title).toBe("Rivers");
    expect(queryClient.getQueryData(queryKeys.libraryDocumentMeta("demo-water-cycle"))).toEqual(
      expect.objectContaining({ updatedAt: fakeApi.get("demo-water-cycle")?.updatedAt }),
    );
  });

  it("a stale save rejects with reason and invalidates the working copy", async () => {
    const queryClient = newClient();
    const body = (await queryClient.fetchQuery(
      libraryQueries.document("demo-water-cycle"),
    )) as Lesson;
    const invalidate = mock(queryClient.invalidateQueries.bind(queryClient));
    queryClient.invalidateQueries = invalidate;
    fakeApi.touch("demo-water-cycle");

    const failure = await run(libraryMutations.autosaveDocument(queryClient), {
      ...body,
      title: "Late",
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(409);
    expect((failure as ApiError).reason).toBe("stale");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.libraryDocument("demo-water-cycle"),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.libraryDocumentMeta("demo-water-cycle"),
    });
    expect(fakeApi.get("demo-water-cycle")?.body.title).toBe("The water cycle");
  });

  it("a save under the generating lock rejects with reason generating", async () => {
    const queryClient = newClient();
    const body = (await queryClient.fetchQuery(
      libraryQueries.document("demo-water-cycle"),
    )) as Lesson;
    fakeApi.setGenerating("demo-water-cycle", "job-1");
    const failure = await run(libraryMutations.autosaveDocument(queryClient), body).catch(
      (error: unknown) => error,
    );
    expect((failure as ApiError).reason).toBe("generating");
    const meta = await queryClient.fetchQuery(libraryQueries.documentMeta("demo-water-cycle"));
    expect(meta?.generatingJobId).toBe("job-1");
  });

  it("duplicate posts a copy with fresh slide ids; delete and restore hit their routes", async () => {
    const queryClient = newClient();
    const copy = await run(libraryMutations.duplicateDocument(queryClient), ["demo-water-cycle"]);
    expect(copy?.title).toBe("The water cycle (copy)");
    expect(copy?.id).not.toBe("demo-water-cycle");
    const source = fakeApi.get("demo-water-cycle")?.body as Lesson;
    const cloned = fakeApi.get(copy?.id ?? "")?.body as Lesson;
    expect(cloned.slides).toHaveLength(source.slides.length);
    expect(cloned.slides[0]?.id).not.toBe(source.slides[0]?.id);
    expect(await run(libraryMutations.duplicateDocument(queryClient), ["nope"])).toBeNull();

    expect(await run(libraryMutations.softDeleteDocument(queryClient), "demo-water-cycle")).toBe(
      true,
    );
    expect(lastRequest()?.method).toBe("DELETE");
    expect(fakeApi.get("demo-water-cycle")?.deletedAt).not.toBeNull();
    expect(await run(libraryMutations.restoreDocument(queryClient), "demo-water-cycle")).toBe(true);
    expect(lastRequest()?.path).toBe("/documents/demo-water-cycle/restore");
    expect(fakeApi.get("demo-water-cycle")?.deletedAt).toBeNull();
  });

  it("series mutations edit lessonIds through PUT and skip the write for a no-op", async () => {
    const queryClient = newClient();
    const created = await run(libraryMutations.createSeries(queryClient), ["Unit", ["rivers"]]);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.lessonIds).toEqual(["rivers"]);

    const added = await run(libraryMutations.addLessonsToSeries(queryClient), [
      created.id,
      ["rivers", "plant-parts", "electricity"],
      0,
    ]);
    expect(added.lessonIds).toEqual(["plant-parts", "electricity", "rivers"]);

    const requests = fakeApi.requests.length;
    const unchanged = await run(libraryMutations.setSeriesLessons(queryClient), [
      created.id,
      ["plant-parts", "electricity", "rivers", "not-held"],
    ]);
    expect(unchanged.lessonIds).toEqual(["plant-parts", "electricity", "rivers"]);
    // One GET, no PUT: the order did not change.
    expect(fakeApi.requests.slice(requests).map((r) => r.method)).toEqual(["GET"]);

    const reordered = await run(libraryMutations.setSeriesLessons(queryClient), [
      created.id,
      ["rivers", "electricity", "plant-parts"],
    ]);
    expect(reordered.lessonIds).toEqual(["rivers", "electricity", "plant-parts"]);
    const removed = await run(libraryMutations.removeLessonFromSeries(queryClient), [
      created.id,
      "electricity",
    ]);
    expect(removed.lessonIds).toEqual(["rivers", "plant-parts"]);

    expect(await run(libraryMutations.renameSeries(queryClient), [created.id, " Rome "])).toBe(
      true,
    );
    expect(fakeApi.get(created.id)?.body.title).toBe("Rome");
    const copy = await run(libraryMutations.duplicateSeries(queryClient), [created.id]);
    expect(copy?.title).toBe("Rome (copy)");
    expect(copy?.lessonIds).toEqual(["rivers", "plant-parts"]);
    expect(await run(libraryMutations.softDeleteSeries(queryClient), created.id)).toBe(true);
    expect(await run(libraryMutations.restoreSeries(queryClient), created.id)).toBe(true);
  });

  it("createLesson posts the brief and returns the lesson and job ids", async () => {
    const queryClient = newClient();
    const result = await run(libraryMutations.createLesson(queryClient), {
      brief: { topic: "Fractions of amounts" },
      yearGroup: "Year 5",
    });
    expect(lastRequest()?.path).toBe("/lessons");
    expect(result.lessonId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fakeApi.get(result.lessonId)?.generatingJobId).toBe(result.jobId);
  });

  it("invalidates the library family after every list-changing mutation", async () => {
    const queryClient = newClient();
    const invalidateQueries = mock().mockResolvedValue(undefined);
    queryClient.invalidateQueries = invalidateQueries;

    const onSuccess = [
      libraryMutations.createDocument(queryClient),
      libraryMutations.createLesson(queryClient),
      libraryMutations.duplicateDocument(queryClient),
      libraryMutations.restoreDocument(queryClient),
      libraryMutations.createSeries(queryClient),
      libraryMutations.duplicateSeries(queryClient),
      libraryMutations.restoreSeries(queryClient),
    ] as UseMutationOptions<unknown, Error, unknown>[];
    for (const options of onSuccess) {
      await invokeOnSuccess(options.onSuccess);
      expect(invalidateQueries).toHaveBeenLastCalledWith({ queryKey: queryKeys.library });
    }
    // The optimistic ones reconcile on settle, success or failure.
    const onSettled = [
      libraryMutations.renameDocument(queryClient),
      libraryMutations.softDeleteDocument(queryClient),
      libraryMutations.renameSeries(queryClient),
      libraryMutations.addLessonsToSeries(queryClient),
      libraryMutations.removeLessonFromSeries(queryClient),
      libraryMutations.setSeriesLessons(queryClient),
      libraryMutations.softDeleteSeries(queryClient),
    ] as UseMutationOptions<unknown, Error, unknown, unknown>[];
    for (const options of onSettled) {
      await options.onSettled?.(
        undefined,
        null,
        undefined,
        undefined,
        {} as MutationFunctionContext,
      );
      expect(invalidateQueries).toHaveBeenLastCalledWith({ queryKey: queryKeys.library });
    }
    expect(invalidateQueries).toHaveBeenCalledTimes(onSuccess.length + onSettled.length);

    // The editors' saves refresh the lists but never the working copy they are saving.
    invalidateQueries.mockClear();
    await invokeOnSuccess(libraryMutations.autosaveDocument(queryClient).onSuccess);
    await invokeOnSuccess(libraryMutations.saveDocument(queryClient).onSuccess);
    const keys = invalidateQueries.mock.calls.map(
      ([call]) => (call as { queryKey: unknown }).queryKey,
    );
    expect(keys).toContainEqual(queryKeys.libraryDocuments);
    expect(keys).toContainEqual(queryKeys.librarySeries);
    expect(keys).not.toContainEqual(queryKeys.library);
  });
});

describe("optimistic updates", () => {
  const titles = (queryClient: QueryClient): string[] => {
    const data = queryClient.getQueryData(libraryQueries.documents("lesson").queryKey);
    return data ? librarySelectors.items(data).map((row) => row.title) : [];
  };

  it("rename shows in every cached list before the PUT lands, and stays after", async () => {
    const queryClient = newClient();
    await queryClient.fetchInfiniteQuery(libraryQueries.documents("lesson"));
    await queryClient.fetchInfiniteQuery(libraryQueries.series());
    await queryClient.fetchQuery(libraryQueries.document("roman-roads"));
    const options = libraryMutations.renameDocument(queryClient);

    const rollback = await options.onMutate?.(
      ["roman-roads", "Roman roads and forts"],
      {} as MutationFunctionContext,
    );
    expect(titles(queryClient)).toContain("Roman roads and forts");
    expect(titles(queryClient)).not.toContain("Roman roads");
    const romans = libraryCache.seriesDetail(queryClient, "series-romans");
    expect(romans?.lessons[0]?.title).toBe("Roman roads and forts");
    const body = queryClient.getQueryData(libraryQueries.document("roman-roads").queryKey);
    expect(body && "title" in body ? body.title : "").toBe("Roman roads and forts");

    // The failure path restores the snapshot — lists, series rows and the body alike.
    rollback?.();
    expect(titles(queryClient)).toContain("Roman roads");
    expect(libraryCache.seriesDetail(queryClient, "series-romans")?.lessons[0]?.title).toBe(
      "Roman roads",
    );
    const restored = queryClient.getQueryData(libraryQueries.document("roman-roads").queryKey);
    expect(restored && "title" in restored ? restored.title : "").toBe("Roman roads");
  });

  it("only cancels list fetches and leaves a rollback to the refetch while another write is in flight", async () => {
    const queryClient = newClient();
    await queryClient.fetchInfiniteQuery(libraryQueries.documents("lesson"));
    const cancel = mock(queryClient.cancelQueries.bind(queryClient));
    queryClient.cancelQueries = cancel;
    const rollback = await libraryMutations
      .softDeleteDocument(queryClient)
      .onMutate?.("roman-roads", {} as MutationFunctionContext);
    const cancelled = cancel.mock.calls.map(
      ([filters]) => (filters as { queryKey: unknown }).queryKey,
    );
    expect(cancelled).toEqual([
      queryKeys.libraryDocuments,
      queryKeys.librarySeries,
      queryKeys.librarySeriesDetails,
    ]);
    expect(cancelled).not.toContainEqual(queryKeys.library);

    // Another write still running: restoring this snapshot would undo its edit, so it is skipped.
    const isMutating = mock(() => 2);
    queryClient.isMutating = isMutating;
    rollback?.();
    expect(titles(queryClient)).not.toContain("Roman roads");
    isMutating.mockReturnValue(1);
    rollback?.();
    expect(titles(queryClient)).toContain("Roman roads");
  });

  it("a failed delete puts the card back; a successful one leaves it gone", async () => {
    const queryClient = newClient();
    await queryClient.fetchInfiniteQuery(libraryQueries.documents("lesson"));
    const options = libraryMutations.softDeleteDocument(queryClient);

    fakeApi.failNext(
      (r) => r.method === "DELETE",
      () =>
        new Response(JSON.stringify({ error: { code: "internal_error", message: "boom" } }), {
          status: 500,
        }),
    );
    const failed = await mutate(options, "roman-roads");
    expect(failed.error).toBeInstanceOf(ApiError);
    expect(titles(queryClient)).toContain("Roman roads");

    const ok = await mutate(options, "roman-roads");
    expect(ok.result).toBe(true);
    expect(fakeApi.get("roman-roads")?.deletedAt).not.toBeNull();
  });

  it("reordering a series moves its cached rows at once", async () => {
    const queryClient = newClient();
    await queryClient.fetchInfiniteQuery(libraryQueries.documents("lesson"));
    await queryClient.fetchQuery(libraryQueries.seriesDetail("series-romans"));
    const options = libraryMutations.setSeriesLessons(queryClient);
    await options.onMutate?.(
      ["series-romans", ["roman-army", "roman-roads", "demo-fractions"]],
      {} as MutationFunctionContext,
    );
    const detail = queryClient.getQueryData(libraryQueries.seriesDetail("series-romans").queryKey);
    expect(detail?.series.lessonIds).toEqual(["roman-army", "roman-roads", "demo-fractions"]);
    expect(detail?.lessons.map((lesson) => lesson.id)).toEqual([
      "roman-army",
      "roman-roads",
      "demo-fractions",
    ]);

    // Adding a lesson the lists know paints its row from the cached summary.
    const add = libraryMutations.addLessonsToSeries(queryClient);
    await add.onMutate?.(["series-romans", ["rivers"], 0], {} as MutationFunctionContext);
    const after = queryClient.getQueryData(libraryQueries.seriesDetail("series-romans").queryKey);
    expect(after?.lessons[0]?.title).toBe("How rivers shape the land");
  });
});

describe("librarySelectors", () => {
  it("flattens pages and counts loaded rows", () => {
    const data = {
      pages: [
        { items: [summary({ id: "a" }), summary({ id: "b" })] },
        { items: [summary({ id: "c" })] },
      ],
      pageParams: [undefined, "2"],
    };
    expect(librarySelectors.items(data).map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(librarySelectors.count(data)).toBe(3);
  });
});

describe("sortDocuments", () => {
  const documents = [
    summary({ id: "b", title: "Bears", updatedAt: "2026-09-02T00:00:00.000Z" }),
    summary({ id: "a", title: "apples", updatedAt: "2026-09-03T00:00:00.000Z" }),
    summary({
      id: "c",
      title: "10 things",
      updatedAt: "2026-09-01T00:00:00.000Z",
      createdAt: "2026-09-04T00:00:00.000Z",
    }),
    summary({ id: "d", title: "2 things", updatedAt: "2026-08-30T00:00:00.000Z" }),
  ];

  it("sorts by title naturally and case-insensitively", () => {
    expect(sortDocuments(documents, "title").map((document) => document.title)).toEqual([
      "2 things",
      "10 things",
      "apples",
      "Bears",
    ]);
  });

  it("sorts by edited or created, newest first", () => {
    expect(sortDocuments(documents, "edited").map((document) => document.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(sortDocuments(documents, "created").map((document) => document.id)).toEqual([
      "c",
      "b",
      "a",
      "d",
    ]);
  });
});
