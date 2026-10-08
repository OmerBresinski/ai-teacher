import { lessonTheme } from "@tj/editor";
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
  themeCallout,
  onBack,
  onStop,
  stop,
  exportSlot,
  className,
  onViewSlide,
}: Props) {
  const theme = lessonTheme(lesson);
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
              // Each arrival opens a new "next slide" slot below it rather than pushing the old one
              // down the page (so the list growing is not a layout shift).
              <div key={count} className="mobile-generation-next" data-mobile-loading-slot>
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
      <footer className="mobile-generation-footer">
        {themeCallout ? (
          <div className="mobile-generation-theme" data-generating-theme>
            {themeCallout}
          </div>
        ) : null}
        <span className="mobile-generation-lock" data-testid="generating-lock">
          <Lock aria-hidden size={13} />
          <span>{lockLine}</span>
        </span>
        {exportSlot}
      </footer>
    </div>
  );
}
