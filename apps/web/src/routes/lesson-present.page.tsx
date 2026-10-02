import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  type NextLesson,
  type PresentProgress,
  PresentView,
  storedSlideId,
  useFittedLesson,
} from "@tj/editor/present";
import { Spinner } from "@tj/ui";
import { useCallback, useMemo } from "react";
import { WrongKindPage } from "@/components/wrong-kind-page";
import { isFullDocument, libraryMutations, libraryQueries } from "@/lib/library";
import { meQueryOptions } from "@/lib/query";
import { lessonPresentRoute } from "./documents.route";
import "@tj/editor/styles/editor.css";

/**
 * `/l/$lessonId/present` (TEACH-101). `?series=` says this lesson is one of several being taught in
 * order, so the end card can offer the next one and exit returns to the series; `?from=` covers the
 * viewer (and the editor, in phase C); `?slide=` is the 1-based slide to open on. On exit the
 * furthest slide reached and, when the session left slide 1, `taughtAt` are written through the
 * save mutation (TD item 5, ADR 0021 §4).
 */
export function LessonPresentPage() {
  const { lessonId } = useParams({ from: lessonPresentRoute.id });
  const { series: seriesId, from, slide } = useSearch({ from: lessonPresentRoute.id });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery(libraryQueries.document(lessonId, queryClient));
  const { data: series } = useQuery({
    ...libraryQueries.seriesDetail(seriesId ?? "", queryClient),
    enabled: Boolean(seriesId),
  });
  const { mutate: save } = useMutation(libraryMutations.saveDocument(queryClient));
  // A signed-out visitor presents a read-only lesson (TEACH-245, ruling 109): progress is not saved,
  // so no `PUT /documents` is ever sent from an anonymous session.
  const { data: me } = useQuery({ ...meQueryOptions, staleTime: Number.POSITIVE_INFINITY });
  const readOnly = me?.user.isAnonymous === true;

  const next = useMemo<NextLesson | undefined>(() => {
    if (!seriesId || !series) return undefined;
    const at = series.lessons.findIndex((l) => l.id === lessonId);
    const following = at === -1 ? undefined : series.lessons[at + 1];
    if (!following) return undefined;
    return {
      title: following.title,
      onOpen: () =>
        void navigate({
          to: "/l/$lessonId/present",
          params: { lessonId: following.id },
          search: { series: seriesId },
        }),
    };
  }, [seriesId, series, lessonId, navigate]);

  // Out goes back where the teacher came from: the series page, the viewer (`from=view`) or the
  // editor (the default — Present from a card lands on the editor too).
  const onExit = useCallback(() => {
    if (seriesId) {
      void navigate({ to: "/series/$seriesId", params: { seriesId } });
      return;
    }
    if (from === "view") {
      void navigate({ to: "/l/$lessonId/view", params: { lessonId } });
      return;
    }
    void navigate({ to: "/l/$lessonId", params: { lessonId } });
  }, [navigate, seriesId, lessonId, from]);

  const lesson = data && isFullDocument(data) && "slides" in data ? data : null;
  // A lesson stored under older floors is drawn re-fitted, as the editor would leave it; the stored
  // copy is what progress is written onto (`useFittedLesson`: nothing else is saved from here).
  const fitted = useFittedLesson(lesson);

  const onProgress = useCallback(
    ({ reachedSlideId, exitedPastFirst }: PresentProgress) => {
      if (!lesson || readOnly) return;
      save({
        ...lesson,
        reachedSlideId: (fitted && storedSlideId(fitted, lesson, reachedSlideId)) ?? reachedSlideId,
        ...(exitedPastFirst ? { taughtAt: new Date().toISOString() } : {}),
      });
    },
    [lesson, fitted, readOnly, save],
  );

  if (!data || !isFullDocument(data)) return <Loading />;
  if (!lesson) {
    return <WrongKindPage document={{ id: data.id, title: data.title, kind: "worksheet" }} />;
  }
  if (!fitted) return <Loading />;

  return (
    <PresentView
      key={lessonId}
      lesson={fitted}
      startIndex={slide ? slide - 1 : 0}
      onExit={onExit}
      next={next}
      onProgress={onProgress}
    />
  );
}

/** The stage's own ground, so the wait is the surface the lesson opens onto. */
function Loading() {
  return (
    <div className="tj-stage flex min-h-dvh items-center justify-center bg-background text-ink-4">
      <Spinner />
    </div>
  );
}
