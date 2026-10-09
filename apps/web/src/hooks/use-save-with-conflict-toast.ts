import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SaveRefusedError } from "@tj/editor/autosave";
import { toast } from "@tj/ui";
import { useCallback } from "react";
import { type LibraryDocument, libraryMutations, libraryQueries } from "@/lib/library";
import { ApiError } from "@/lib/query";

/** The action on a `409 stale` toast (ADR 0024 §4). */
export const RELOAD_LABEL = "Reload";

/**
 * The editors' autosave with the `409` a save can meet (ADR 0024 §4, §18) turned into a toast the
 * teacher can act on: `stale` offers **Reload** — refetch the working copy, which the mutation has
 * already invalidated, so the editor re-renders from the stored document; `generating` just says
 * why the save was refused. The rejection still propagates — as `SaveRefusedError`, so the editor's
 * indicator shows "Not saved" without a second, generic toast over this one.
 */
export function useSaveWithConflictToast(
  documentId: string,
  /**
   * A lesson that is still filling (ADR 0037): a `stale` save is expected (the job wrote since).
   * This folds the job's row into the editor and returns the merged copy, which is saved once more
   * instead of the toast.
   */
  onStale?: () => Promise<LibraryDocument | undefined>,
): (document: LibraryDocument) => Promise<void> {
  const queryClient = useQueryClient();
  const { mutateAsync: save } = useMutation(libraryMutations.autosaveDocument(queryClient));
  return useCallback(
    async (document: LibraryDocument) => {
      try {
        await save(document);
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          error.reason === "stale" &&
          onStale
        ) {
          const merged = await onStale();
          if (merged) return save(merged);
        }
        if (error instanceof ApiError && error.status === 409) {
          const stale = error.reason === "stale";
          toast(error.message, {
            duration: stale ? Number.POSITIVE_INFINITY : undefined,
            action: stale
              ? {
                  label: RELOAD_LABEL,
                  onClick: () =>
                    void queryClient.refetchQueries({
                      queryKey: libraryQueries.document(documentId).queryKey,
                    }),
                }
              : undefined,
          });
          throw new SaveRefusedError(error.message, { cause: error });
        }
        throw error;
      }
    },
    [save, queryClient, documentId, onStale],
  );
}
