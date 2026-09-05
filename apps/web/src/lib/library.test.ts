import { describe, expect, it, mock } from "bun:test";
import {
  type MutationFunctionContext,
  QueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { libraryMutations, libraryQueries, sortDocuments } from "./library";
import { queryKeys } from "./query";

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

describe("library queries", () => {
  it("uses the library query-key family", () => {
    expect<readonly unknown[]>(libraryQueries.documents().queryKey).toEqual(
      queryKeys.libraryDocuments,
    );
    expect<readonly unknown[]>(libraryQueries.series().queryKey).toEqual(queryKeys.librarySeries);
    expect<readonly unknown[]>(libraryQueries.seriesDetail("s1").queryKey).toEqual(
      queryKeys.librarySeriesDetail("s1"),
    );
  });

  it("invalidates the full library family after every mutation", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = mock().mockResolvedValue(undefined);
    queryClient.invalidateQueries = invalidateQueries;

    const onSuccess = [
      () => invokeOnSuccess(libraryMutations.createDocument(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.renameDocument(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.duplicateDocument(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.softDeleteDocument(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.restoreDocument(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.createSeries(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.renameSeries(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.duplicateSeries(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.addLessonsToSeries(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.removeLessonFromSeries(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.setSeriesLessons(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.softDeleteSeries(queryClient).onSuccess),
      () => invokeOnSuccess(libraryMutations.restoreSeries(queryClient).onSuccess),
    ];

    for (const invoke of onSuccess) {
      await invoke();
      expect(invalidateQueries).toHaveBeenLastCalledWith({ queryKey: queryKeys.library });
    }

    expect(invalidateQueries).toHaveBeenCalledTimes(onSuccess.length);
  });
});

describe("sortDocuments", () => {
  const documents = [
    {
      id: "1",
      kind: "lesson" as const,
      title: "Zoo",
      count: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      themeId: "chalk",
    },
    {
      id: "2",
      kind: "lesson" as const,
      title: "Écoles",
      count: 1,
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      themeId: "chalk",
    },
    {
      id: "3",
      kind: "lesson" as const,
      title: "Apples",
      count: 1,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      themeId: "chalk",
    },
  ];

  it("sorts titles with a locale-aware collator", () => {
    expect(sortDocuments(documents, "title").map((document) => document.title)).toEqual([
      "Apples",
      "Écoles",
      "Zoo",
    ]);
  });

  it("sorts edited and created dates newest first", () => {
    expect(sortDocuments(documents, "edited").map((document) => document.id)).toEqual([
      "1",
      "3",
      "2",
    ]);
    expect(sortDocuments(documents, "created").map((document) => document.id)).toEqual([
      "2",
      "3",
      "1",
    ]);
  });

  it("falls back to the edit stamp for legacy summaries without a creation stamp", () => {
    const legacy = { id: "legacy", title: "Legacy", updatedAt: "2026-01-04T00:00:00.000Z" };
    const sorted = sortDocuments([...documents, legacy], "created");

    expect(sorted.map((document) => document.id)).toEqual(["legacy", "2", "3", "1"]);
  });
});
