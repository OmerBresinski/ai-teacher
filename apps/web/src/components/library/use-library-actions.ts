import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "@tj/ui";
import type { LibraryCardProps } from "@/components/library-card";
import type { NewDocumentValues } from "@/components/new-document-dialog";
import type { SeriesCardProps } from "@/components/series-card";
import { libraryMutations } from "@/lib/library";
import type { DocumentSummary, SeriesWithLessons } from "@/mocks/library-schema";

/** TeachDeck's delete Undo window. */
export const UNDO_MS = 6000;

type DocumentAction = Parameters<LibraryCardProps["onAction"]>[0];
type SeriesAction = Parameters<SeriesCardProps["onAction"]>[0];

/**
 * Every write the library screens perform, with its navigation and toast, in one place. The mock
 * store behind `libraryMutations` is swapped for the API without touching this file's callers.
 */
export function useLibraryActions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const duplicateDocument = useMutation(libraryMutations.duplicateDocument(queryClient));
  const renameDocument = useMutation(libraryMutations.renameDocument(queryClient));
  const softDeleteDocument = useMutation(libraryMutations.softDeleteDocument(queryClient));
  const restoreDocument = useMutation(libraryMutations.restoreDocument(queryClient));
  const duplicateSeries = useMutation(libraryMutations.duplicateSeries(queryClient));
  const renameSeries = useMutation(libraryMutations.renameSeries(queryClient));
  const softDeleteSeries = useMutation(libraryMutations.softDeleteSeries(queryClient));
  const restoreSeries = useMutation(libraryMutations.restoreSeries(queryClient));
  const createDocument = useMutation(libraryMutations.createDocument(queryClient));
  const createSeries = useMutation(libraryMutations.createSeries(queryClient));

  function openDocument(doc: Pick<DocumentSummary, "id" | "kind">): void {
    if (doc.kind === "lesson") void navigate({ to: "/l/$lessonId", params: { lessonId: doc.id } });
    else void navigate({ to: "/w/$worksheetId", params: { worksheetId: doc.id } });
  }

  /** Toast once the store confirms, so Undo never offers to restore something still being deleted. */
  function undoToast(title: string, restore: () => void): () => void {
    return () =>
      toast(`Deleted “${title}”`, {
        duration: UNDO_MS,
        action: { label: "Undo", onClick: restore },
      });
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
          duplicateDocument.mutate([doc.id], {
            onSuccess: () => toast(`Duplicated “${doc.title}”`),
          });
          return;
        case "delete":
          softDeleteDocument.mutate(doc.id, {
            onSuccess: undoToast(doc.title, () => restoreDocument.mutate(doc.id)),
          });
          return;
        case "export":
          toast("Export arrives with the editor");
      }
    },
    onDocumentRename(doc: DocumentSummary, title: string): void {
      renameDocument.mutate([doc.id, title]);
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
          duplicateSeries.mutate([item.series.id], {
            onSuccess: () => toast(`Duplicated “${item.series.title}”`),
          });
          return;
        case "delete":
          softDeleteSeries.mutate(item.series.id, {
            onSuccess: undoToast(item.series.title, () => restoreSeries.mutate(item.series.id)),
          });
      }
    },
    onSeriesRename(item: SeriesWithLessons, title: string): void {
      renameSeries.mutate([item.series.id, title]);
    },
    async createNewDocument(
      kind: "lesson" | "worksheet",
      values: NewDocumentValues,
    ): Promise<void> {
      const document = await createDocument.mutateAsync({ kind, ...values });
      openDocument(document);
    },
    async createNewSeries(title: string): Promise<void> {
      const series = await createSeries.mutateAsync([title]);
      await navigate({ to: "/series/$seriesId", params: { seriesId: series.id } });
    },
  };
}
