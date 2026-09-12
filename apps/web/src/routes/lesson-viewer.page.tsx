import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ExportControl } from "@tj/editor/export";
import { LessonViewer } from "@tj/editor/present";
import { IconButton, toast } from "@tj/ui";
import { ArrowLeft } from "lucide-react";
import { RoutePendingPage } from "@/components/route-pending-page";
import { WrongKindPage } from "@/components/wrong-kind-page";
import { useShellReturn } from "@/lib/last-shell";
import { isFullDocument, kindOf, libraryMutations, libraryQueries } from "@/lib/library";
import { openPrintTab } from "@/lib/print-tab";
import { lessonViewRoute } from "./documents.route";
import "@tj/editor/styles/editor.css";

/**
 * `/l/$lessonId/view` — the read-only viewer (TEACH-100; `/l/$lessonId` is the editor since
 * TEACH-103). The loader has already resolved the document (or 404ed); until the full body arrives
 * the list placeholder is a summary, so the page waits. A worksheet id on a lesson route shows the
 * `WrongKindPage`.
 */
export function LessonViewerPage() {
  const { lessonId } = useParams({ from: lessonViewRoute.id });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const shellReturn = useShellReturn();
  const { data } = useQuery(libraryQueries.document(lessonId, queryClient));
  const { mutateAsync: duplicate } = useMutation(libraryMutations.duplicateDocument(queryClient));

  if (!data || !isFullDocument(data)) return <RoutePendingPage />;
  if (kindOf(data) !== "lesson" || !("slides" in data)) {
    return <WrongKindPage document={{ id: data.id, title: data.title, kind: "worksheet" }} />;
  }

  const onDuplicate = async () => {
    const copy = await duplicate([lessonId]);
    if (!copy) {
      toast("That lesson could not be copied.");
      return;
    }
    toast(`Duplicated “${data.title}”`);
    await navigate({ to: "/l/$lessonId/view", params: { lessonId: copy.id } });
  };

  return (
    <LessonViewer
      lesson={data}
      leading={
        <IconButton label="Back to the library" onClick={() => void navigate({ to: shellReturn })}>
          <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
      }
      exportSlot={<ExportControl document={data} onOpenPrint={openPrintTab} />}
      onPresent={(slide) =>
        void navigate({
          to: "/l/$lessonId/present",
          params: { lessonId },
          search: { series: undefined, slide, from: "view" },
        })
      }
      onDuplicate={onDuplicate}
    />
  );
}
