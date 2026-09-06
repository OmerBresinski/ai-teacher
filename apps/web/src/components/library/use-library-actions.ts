import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "@tj/ui";
import { useMemo } from "react";
import type { LibraryCardProps } from "@/components/library-card";
import type { NewDocumentValues } from "@/components/new-document-dialog";
import type { SeriesCardProps } from "@/components/series-card";
import { libraryMutations } from "@/lib/library";
import type { DocumentSummary, SeriesWithLessons } from "@/mocks/library-schema";

/** TeachDeck's delete Undo window. */
export const UNDO_MS = 6000;

type DocumentAction = Parameters<LibraryCardProps["onAction"]>[0];
type SeriesAction = Parameters<SeriesCardProps["onAction"]>[0];

/** Toast once the store confirms, so Undo never offers to restore something still being deleted. */
function undoToast(title: string, restore: () => void): () => void {
  return () =>
    toast(`Deleted “${title}”`, {
      duration: UNDO_MS,
      action: { label: "Undo", onClick: restore },
    });
}

/**
 * Every write the library screens perform, with its navigation and toast, in one place. The mock
 * store behind `libraryMutations` is swapped for the API without touching this file's callers.
 *
 * The returned handlers are referentially stable: `navigate` and each mutation's `mutate` /
 * `mutateAsync` keep their identity across renders, so memoised cards (`LibraryCard`,
 * `SeriesCard`) skip re-rendering while the user types in the search box or the minute clock ticks.
 */
export function useLibraryActions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { mutate: duplicateDocument } = useMutation(
    libraryMutations.duplicateDocument(queryClient),
  );
  const { mutate: renameDocument } = useMutation(libraryMutations.renameDocument(queryClient));
  const { mutate: softDeleteDocument } = useMutation(
    libraryMutations.softDeleteDocument(queryClient),
  );
  const { mutate: restoreDocument } = useMutation(libraryMutations.restoreDocument(queryClient));
  const { mutate: duplicateSeries } = useMutation(libraryMutations.duplicateSeries(queryClient));
  const { mutate: renameSeries } = useMutation(libraryMutations.renameSeries(queryClient));
  const { mutate: softDeleteSeries } = useMutation(libraryMutations.softDeleteSeries(queryClient));
  const { mutate: restoreSeries } = useMutation(libraryMutations.restoreSeries(queryClient));
  const { mutateAsync: createDocument } = useMutation(libraryMutations.createDocument(queryClient));
  const { mutateAsync: createSeries } = useMutation(libraryMutations.createSeries(queryClient));

  return useMemo(() => {
    function openDocument(doc: Pick<DocumentSummary, "id" | "kind">): void {
      if (doc.kind === "lesson") {
        void navigate({ to: "/l/$lessonId", params: { lessonId: doc.id } });
      } else {
        void navigate({ to: "/w/$worksheetId", params: { worksheetId: doc.id } });
      }
    }

    return {
      onDocumentAction(action: DocumentAction, doc: DocumentSummary): void {
        switch (action) {
          case "open":
            openDocument(doc);
            return;
          case "present":
            void navigate({ to: "/l/$lessonId/present", params: { lessonId: doc.id } });
            return;
          case "duplicate":
            duplicateDocument([doc.id], {
              onSuccess: () => toast(`Duplicated “${doc.title}”`),
            });
            return;
          case "delete":
            softDeleteDocument(doc.id, {
              onSuccess: undoToast(doc.title, () => restoreDocument(doc.id)),
            });
            return;
          case "export":
            toast("Export arrives with the editor");
        }
      },
      onDocumentRename(doc: DocumentSummary, title: string): void {
        renameDocument([doc.id, title]);
      },
      onSeriesAction(action: SeriesAction, item: SeriesWithLessons): void {
        switch (action) {
          case "present": {
            const first = item.lessons[0];
            if (!first) return;
            void navigate({
              to: "/l/$lessonId/present",
              params: { lessonId: first.id },
              search: { series: item.series.id },
            });
            return;
          }
          case "duplicate":
            duplicateSeries([item.series.id], {
              onSuccess: () => toast(`Duplicated “${item.series.title}”`),
            });
            return;
          case "delete":
            softDeleteSeries(item.series.id, {
              onSuccess: undoToast(item.series.title, () => restoreSeries(item.series.id)),
            });
        }
      },
      onSeriesRename(item: SeriesWithLessons, title: string): void {
        renameSeries([item.series.id, title]);
      },
      async createNewDocument(
        kind: "lesson" | "worksheet",
        values: NewDocumentValues,
      ): Promise<void> {
        const document = await createDocument({ kind, ...values });
        openDocument(document);
      },
      async createNewSeries(title: string): Promise<void> {
        const series = await createSeries([title]);
        await navigate({ to: "/series/$seriesId", params: { seriesId: series.id } });
      },
    };
  }, [
    navigate,
    duplicateDocument,
    renameDocument,
    softDeleteDocument,
    restoreDocument,
    duplicateSeries,
    renameSeries,
    softDeleteSeries,
    restoreSeries,
    createDocument,
    createSeries,
  ]);
}
