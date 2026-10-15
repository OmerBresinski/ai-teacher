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
  /**
   * Live writing (ADR 0039): the job holding the lock, as the editor knows it, when it is the job
   * this editor is following (this lesson's own stream); `undefined` otherwise.
   */
  ownJob?: () => string | undefined,
): (document: LibraryDocument) => Promise<void> {
  const queryClient = useQueryClient();
  const { mutateAsync: save } = useMutation(libraryMutations.autosaveDocument(queryClient));
  /** The job holding the lesson's lock, as this editor last read the row. */
  const lockedBy = useCallback(
    (): string | undefined =>
      queryClient.getQueryData(libraryQueries.documentMeta(documentId).queryKey)?.generatingJobId ??
      undefined,
    [queryClient, documentId],
  );
  return useCallback(
    async (document: LibraryDocument) => {
      const refuse = async (error: unknown): Promise<never> => {
        if (error instanceof ApiError && error.status === 409) {
          // Live writing (ADR 0039): a filling lesson's editor opens before any slide is done, and
          // a save then is refused as `generating` by design; the next save after a slide is done
          // carries the whole document, so the refusal is not the teacher's to see. Only when the
          // lock is still the job this editor follows: another job's lock (another tab, a
          // regenerate) keeps its toast.
          if (
            error.reason === "generating" &&
            ownJob &&
            lockedBy() !== undefined &&
            lockedBy() === ownJob()
          )
            throw new SaveRefusedError(error.message, { cause: error });
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
      };
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
          // The merged copy gets one more save; if that is refused too (the job wrote again in
          // between), it takes the same toast path as the first refusal rather than failing silently.
          if (merged) {
            try {
              await save(merged);
              return;
            } catch (retryError) {
              await refuse(retryError);
            }
          }
        }
        await refuse(error);
      }
    },
    [save, queryClient, documentId, onStale, ownJob, lockedBy],
  );
}
