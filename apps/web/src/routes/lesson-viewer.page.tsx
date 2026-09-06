import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { LessonViewer } from "@tj/editor/present";
import { Button, IconButton, Tooltip, toast } from "@tj/ui";
import { ArrowLeft } from "lucide-react";
import { RoutePendingPage } from "@/components/route-pending-page";
import { useShellReturn } from "@/lib/last-shell";
import { isFullDocument, kindOf, libraryMutations, libraryQueries } from "@/lib/library";
import { EditorStubPage } from "./editor-stubs.page";
import { lessonEditorRoute } from "./editor-stubs.route";

/**
 * `/l/$lessonId` — the read-only viewer (TEACH-100). The loader has already resolved the document
 * (or 404ed); until the full body arrives the list placeholder is a summary, so the page waits. A
 * worksheet id on a lesson route shows the stub, as before. The editor takes this route over in
 * phase C and the viewer moves to `/l/$lessonId/view`.
 */
export function LessonViewerPage() {
  const { lessonId } = useParams({ from: lessonEditorRoute.id });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const shellReturn = useShellReturn();
  const { data } = useQuery(libraryQueries.document(lessonId, queryClient));
  const { mutateAsync: duplicate } = useMutation(libraryMutations.duplicateDocument(queryClient));

  if (!data || !isFullDocument(data)) return <RoutePendingPage />;
  if (kindOf(data) !== "lesson" || !("slides" in data)) return <EditorStubPage />;

  const onDuplicate = async () => {
    const copy = await duplicate([lessonId]);
    if (!copy) {
      toast("That lesson could not be copied.");
      return;
    }
    toast(`Duplicated “${data.title}”`);
    await navigate({ to: "/l/$lessonId", params: { lessonId: copy.id } });
  };

  return (
    <LessonViewer
      lesson={data}
      leading={
        <IconButton label="Back to the library" onClick={() => void navigate({ to: shellReturn })}>
          <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
      }
      exportSlot={
        // `aria-disabled`, not `disabled`: a disabled button swallows pointer and focus events, so
        // its tooltip could never open. This one announces as disabled, stays focusable and does nothing.
        <Tooltip label="Export arrives with the export phase">
          <Button variant="ghost" size="sm" aria-disabled="true" className="opacity-50">
            Export
          </Button>
        </Tooltip>
      }
      onPresent={(slide) =>
        void navigate({
          to: "/l/$lessonId/present",
          params: { lessonId },
          search: { series: undefined, slide },
        })
      }
      onDuplicate={onDuplicate}
    />
  );
}
