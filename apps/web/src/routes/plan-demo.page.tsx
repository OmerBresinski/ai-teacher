import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { plannedLesson } from "@tj/domain/documents/fixtures";
import { useEffect } from "react";
import { RoutePendingPage } from "@/components/route-pending-page";
import { queryKeys } from "@/lib/query";

/**
 * Seeds the planned fixture under the same keys `seedGeneratingLesson` uses (the body and its
 * row state, unlocked) and navigates to the lesson route, which renders `PlanReview`. The entries
 * are pinned fresh so the page never asks the API for a lesson it does not have.
 */
export function PlanDemoPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    const lesson = plannedLesson();
    for (const key of [
      queryKeys.libraryDocument(lesson.id),
      queryKeys.libraryDocumentMeta(lesson.id),
    ]) {
      queryClient.setQueryDefaults(key, { staleTime: Number.POSITIVE_INFINITY, retry: false });
    }
    queryClient.setQueryData(queryKeys.libraryDocument(lesson.id), lesson);
    queryClient.setQueryData(queryKeys.libraryDocumentMeta(lesson.id), {
      createdAt: lesson.createdAt,
      updatedAt: lesson.updatedAt,
      deletedAt: null,
      generatingJobId: null,
    });
    void navigate({ to: "/l/$lessonId", params: { lessonId: lesson.id }, replace: true });
  }, [queryClient, navigate]);
  return <RoutePendingPage />;
}
