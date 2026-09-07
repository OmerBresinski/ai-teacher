import { Link, useNavigate } from "@tanstack/react-router";
import type { DocumentSummary } from "@tj/domain/documents";
import { AppBar, AppBarGroup, AppBarTitle, Button, EmptyState, IconButton } from "@tj/ui";
import { ArrowLeft, FileText, Presentation } from "lucide-react";
import { useShellReturn } from "@/lib/last-shell";

const WORKSHEET_ICON = <FileText strokeWidth={1.5} />;
const LESSON_ICON = <Presentation strokeWidth={1.5} />;

/**
 * A document opened on the other kind's route — a worksheet id under `/l/*`, a lesson id under
 * `/w/*`. The loader has resolved the document, so this is a wrong turn, not a 404: say which kind
 * it is and offer the route that opens it, plus the way back to the library.
 */
export function WrongKindPage({
  document,
}: {
  document: { id: string; title: string; kind: DocumentSummary["kind"] };
}) {
  const shellReturn = useShellReturn();
  const navigate = useNavigate();
  const worksheet = document.kind === "worksheet";
  return (
    <div className="min-h-dvh bg-background">
      <AppBar>
        <AppBarGroup>
          <IconButton
            label="Back to the library"
            onClick={() => void navigate({ to: shellReturn })}
          >
            <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
          <AppBarTitle>{document.title}</AppBarTitle>
        </AppBarGroup>
      </AppBar>
      <main className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-2xl items-center p-6">
        <EmptyState
          icon={worksheet ? WORKSHEET_ICON : LESSON_ICON}
          title={worksheet ? "This is a worksheet" : "This is a lesson"}
          body={
            worksheet
              ? "Worksheets open in the worksheet editor, not on a lesson route."
              : "Lessons open in the lesson editor, not on a worksheet route."
          }
          action={
            <Button asChild>
              {worksheet ? (
                <Link to="/w/$worksheetId" params={{ worksheetId: document.id }}>
                  Open the worksheet
                </Link>
              ) : (
                <Link to="/l/$lessonId" params={{ lessonId: document.id }}>
                  Open the lesson
                </Link>
              )}
            </Button>
          }
        />
      </main>
    </div>
  );
}
