import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "@tj/ui";
import { UNDO_MS } from "@/components/library/use-library-actions";
import { libraryMutations } from "@/lib/library";
import type { SeriesWithLessons } from "@/mocks/library-schema";

/** The writes the series detail page performs, with their toasts and navigation. */
export function useSeriesActions(item: SeriesWithLessons | null | undefined) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const rename = useMutation(libraryMutations.renameSeries(queryClient));
  const setLessons = useMutation(libraryMutations.setSeriesLessons(queryClient));
  const addLessons = useMutation(libraryMutations.addLessonsToSeries(queryClient));
  const removeLesson = useMutation(libraryMutations.removeLessonFromSeries(queryClient));
  const seriesId = item?.series.id;

  return {
    rename(title: string): void {
      if (seriesId) rename.mutate([seriesId, title]);
    },
    /** Full order write; the caller has already applied `reorderVisible`. */
    setOrder(lessonIds: string[]): void {
      if (seriesId) setLessons.mutate([seriesId, lessonIds]);
    },
    async add(lessonIds: string[]): Promise<void> {
      if (seriesId) await addLessons.mutateAsync([seriesId, lessonIds]);
    },
    /** Removes and offers Undo, which restores the lesson at its original position. */
    remove(lessonId: string, title: string, originalIndex: number): void {
      if (!seriesId) return;
      removeLesson.mutate([seriesId, lessonId], {
        onSuccess: () =>
          toast(`Removed “${title}”`, {
            duration: UNDO_MS,
            action: {
              label: "Undo",
              onClick: () => addLessons.mutate([seriesId, [lessonId], originalIndex]),
            },
          }),
      });
    },
    presentFirst(): void {
      const first = item?.lessons[0];
      if (!first || !seriesId) return;
      void navigate({
        to: "/l/$lessonId/present",
        params: { lessonId: first.id },
        search: { series: seriesId },
      });
    },
  };
}
