import { useQuery } from "@tanstack/react-query";
import { notFound, useNavigate, useRouterState } from "@tanstack/react-router";
import { AppBar, AppBarGroup, AppBarTitle, Button, EmptyState, IconButton } from "@tj/ui";
import { ArrowLeft, FileText, Presentation } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useShellReturn } from "@/lib/last-shell";
import { libraryQueries } from "@/lib/library";
export function EditorStubPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const documents = useQuery(libraryQueries.documents());
  const navigate = useNavigate();
  const shellReturn = useShellReturn();
  const match = pathname.match(/^\/(?:l|w)\/([^/]+)(?:\/(?:present|print))?$/);
  const document = documents.data?.find((entry) => entry.id === match?.[1]);

  if (!documents.isPending && !document) notFound();
  useDocumentTitle(`${document?.title ?? "Document"} · Teaching Journey`);

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
          <AppBarTitle>{document?.title ?? "Loading document"}</AppBarTitle>
        </AppBarGroup>
      </AppBar>
      <main className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-2xl items-center p-6">
        <EmptyState
          icon={
            document?.kind === "worksheet" ? (
              <FileText strokeWidth={1.5} />
            ) : (
              <Presentation strokeWidth={1.5} />
            )
          }
          title="The editor arrives with @tj/editor"
          body="This document opens in the TeachDeck editor once it is packaged (TD project item 2)."
          action={<Button onClick={backToLibrary}>Back to the library</Button>}
        />
      </main>
    </div>
  );
}
