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
 * it is and offer the route that opens it, plus the way back to the library. `chrome="none"` is for
 * the print route, which renders no app chrome at all (ADR 0023 §2) — the way back is then the
 * secondary link under the message.
 */
export function WrongKindPage({
  document,
  chrome = "app-bar",
}: {
  document: { id: string; title: string; kind: DocumentSummary["kind"] };
  chrome?: "app-bar" | "none";
}) {
  const shellReturn = useShellReturn();
  const navigate = useNavigate();
  const worksheet = document.kind === "worksheet";
  return (
    <div className="min-h-dvh bg-background">
      {chrome === "app-bar" ? (
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
      ) : null}
      <main
        className={
          chrome === "app-bar"
            ? "mx-auto flex min-h-[calc(100dvh-3rem)] max-w-2xl items-center p-6"
            : "mx-auto flex min-h-dvh max-w-2xl items-center p-6"
        }
      >
        <EmptyState
          icon={worksheet ? WORKSHEET_ICON : LESSON_ICON}
          title={worksheet ? "This is a worksheet" : "This is a lesson"}
          body={
            worksheet
              ? "Worksheets open in the worksheet editor, not on a lesson route."
              : "Lessons open in the lesson editor, not on a worksheet route."
          }
          action={
            <Button variant="primary" asChild>
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
          secondaryAction={
            chrome === "none" ? (
              <Button variant="ghost" asChild>
                <Link to={shellReturn}>Back to the library</Link>
              </Button>
            ) : undefined
          }
        />
      </main>
    </div>
  );
}
