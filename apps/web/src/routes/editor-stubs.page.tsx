import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AppBar, AppBarGroup, AppBarTitle, Button, EmptyState, IconButton } from "@tj/ui";
import { ArrowLeft, FileText, Presentation } from "lucide-react";
import { useShellReturn } from "@/lib/last-shell";
import { libraryQueries } from "@/lib/library";

const WORKSHEET_ICON = <FileText strokeWidth={1.5} />;
const LESSON_ICON = <Presentation strokeWidth={1.5} />;

/** One page for `/l/$lessonId(/present)` and `/w/$worksheetId(/print)`; the loader already 404s. */
export function EditorStubPage() {
  const params = useParams({ strict: false });
  const id = params.lessonId ?? params.worksheetId ?? "";
  const queryClient = useQueryClient();
  const { data: document } = useQuery(libraryQueries.document(id, queryClient));
  const navigate = useNavigate();
  const shellReturn = useShellReturn();

  function backToLibrary(): void {
    void navigate({ to: shellReturn });
  }

  return (
    <div className="min-h-dvh bg-background">
      <AppBar>
        <AppBarGroup>
          <IconButton label="Back to the library" onClick={backToLibrary}>
            <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
          <AppBarTitle>{document?.title ?? "Document"}</AppBarTitle>
        </AppBarGroup>
      </AppBar>
      <main className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-2xl items-center p-6">
        <EmptyState
          icon={document?.kind === "worksheet" ? WORKSHEET_ICON : LESSON_ICON}
          title="The editor arrives with @tj/editor"
          body="This document opens in the TeachDeck editor once it is packaged (TD project item 2)."
          action={<Button onClick={backToLibrary}>Back to the library</Button>}
        />
      </main>
    </div>
  );
}
