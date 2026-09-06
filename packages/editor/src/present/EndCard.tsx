import { Button, Display } from "@tj/ui";
import { usePresent } from "./use-present-session";

/** The lesson that follows this one in the series being presented. */
export type NextLesson = { title: string; onOpen: () => void };

/**
 * A distinct end state, not a black screen (TeachDeck `components/v2/present/EndCard.tsx`): the
 * class can see the lesson has finished, and the teacher has somewhere to go. In a series the
 * card advances like a slide: a click anywhere off the buttons opens the next lesson, as Right
 * and Space do from the key map. The card is not focusable on purpose — a stop between the two
 * buttons it contains would be one more Tab for nothing.
 */
export function EndCard({
  title,
  onExit,
  next,
}: {
  title: string;
  onExit: () => void;
  next?: NextLesson;
}) {
  const { dispatch } = usePresent();

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the click is the mouse half of "advance"; Space/Enter/Right do it from the key map and "Next lesson" is a real button inside
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: see above
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <div
      className="absolute inset-0 z-[465] flex items-center justify-center bg-background px-8"
      onClick={
        next
          ? (e) => {
              if ((e.target as HTMLElement).closest("button, a[href]")) return;
              next.onOpen();
            }
          : undefined
      }
    >
      <div className="flex max-w-[46ch] flex-col items-center text-center">
        <p className="font-medium text-ink-3 text-meta">{title}</p>
        <Display size="lg" as="h1" className="mt-2">
          End of lesson
        </Display>
        {next ? <p className="mt-3 text-ink-3 text-lead">Next: {next.title}</p> : null}
        <div className="mt-6 flex items-center gap-2">
          {next ? <Button onClick={next.onOpen}>Next lesson</Button> : null}
          {/* One primary. In a series that is the next lesson, so restarting steps down to text. */}
          <Button
            variant={next ? "ghost" : "default"}
            onClick={() => dispatch({ type: "restart" })}
          >
            Back to start
          </Button>
          <Button variant="ghost" onClick={onExit}>
            Exit
          </Button>
        </div>
      </div>
    </div>
  );
}
