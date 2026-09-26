import { getTheme } from "@tj/editor";
import { MobileSlideList } from "@tj/editor/lesson";
import { Button, cn, IconButton } from "@tj/ui";
import { ArrowLeft, Lock, Square } from "lucide-react";
import type { GeneratingShellProps } from "./GeneratingShell";
import { announcedLine, type StageState } from "./stage";
import "./mobile-generating.css";

type Props = Omit<GeneratingShellProps, "events" | "estimate"> & {
  state: StageState;
  line: string;
  lockLine: string;
};

/** A readable lesson stream, shared by real generation and the fixture preview. */
export function MobileGeneratingShell({
  lesson,
  state,
  line,
  lockLine,
  canvasCompanion,
  onBack,
  onStop,
  stop,
  exportSlot,
  className,
  onViewSlide,
}: Props) {
  const theme = getTheme(lesson.themeId);
  const running = state.terminal === null;
  const count = lesson.slides.length;
  return (
    <div
      data-testid="generating-shell"
      data-mobile-generation
      data-state={state.terminal ?? "running"}
      data-run-stage={state.stage}
      className={cn("flex flex-col overflow-hidden bg-background", className ?? "h-dvh")}
    >
      <header className="mobile-generation-header">
        <IconButton label="Back to library" onClick={onBack}>
          <ArrowLeft aria-hidden size={18} />
        </IconButton>
        <h1 className="truncate text-body font-semibold">{lesson.title}</h1>
        {running ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onStop}
            disabled={stop?.pending || stop?.sent}
            data-generating-stop
          >
            <Square aria-hidden size={14} /> Stop
          </Button>
        ) : null}
      </header>
      <div className="mobile-generation-status">
        <p data-testid="generating-stage" role={state.terminal === "failed" ? "alert" : undefined}>
          {line}
        </p>
        {stop?.error ? <p role="alert">Could not stop the job. Try again.</p> : null}
        {running ? (
          <output className="sr-only" aria-live="polite" data-testid="generating-announcement">
            {announcedLine(state)}
          </output>
        ) : null}
      </div>
      <main className="flex min-h-0 flex-1 flex-col">
        {running && canvasCompanion ? <div data-mobile-companion>{canvasCompanion}</div> : null}
        <MobileSlideList
          slides={lesson.slides}
          theme={theme}
          onView={onViewSlide}
          followArrivals={running}
          footer={
            running ? (
              <div className="mobile-generation-next" data-mobile-loading-slot>
                <p>{count === 0 ? "Preparing your lesson" : "Making the next slide"}</p>
              </div>
            ) : count === 0 ? (
              <p className="p-6 text-center text-ink-3">
                No slides were written before it stopped.
              </p>
            ) : null
          }
        />
      </main>
      <footer className="mobile-generation-footer" data-testid="generating-lock">
        <Lock aria-hidden size={13} />
        <span>{lockLine}</span>
        {exportSlot}
      </footer>
    </div>
  );
}
