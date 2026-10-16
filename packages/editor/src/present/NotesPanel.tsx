import type { Lesson, Theme } from "@tj/domain/documents";
import { X } from "lucide-react";
import { formatClock } from "../slide/elements";
import { SlideStatic } from "../slide/SlideStatic";
import { StageButton } from "./StageButton";
import { useNow } from "./use-now";
import { usePresent } from "./use-present-session";

/**
 * Presenter aids that belong to the teacher, not the class (TeachDeck
 * `components/v2/present/NotesPanel.tsx`): notes, what is coming next, the wall clock and how long
 * the lesson has run. It takes width off the stage rather than covering the slide.
 */
export function NotesPanel({ lesson, theme }: { lesson: Lesson; theme: Theme }) {
  const { state, dispatch } = usePresent();
  const { index, sessionStartedAt } = state;
  const now = useNow(true, 1000);

  const slide = lesson.slides[index];
  const next = lesson.slides[index + 1];
  const notes = slide?.notes?.trim();
  // The Answers slides, for the teacher to read while the class sees the lesson (ruling 240).
  const answers = lesson.slides.filter((s) => s.answersRole === "answers");

  return (
    <aside
      aria-label="Presenter notes"
      className="flex h-full w-[320px] shrink-0 flex-col border-border border-l bg-card text-ink-2"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-border border-b pr-2 pl-4">
        <h2 className="text-body text-foreground">Presenter notes</h2>
        <StageButton
          label="Close presenter notes"
          onClick={() => dispatch({ type: "setNotesOpen", open: false })}
        >
          <X size={16} strokeWidth={1.5} />
        </StageButton>
      </div>

      <div className="flex shrink-0 items-baseline gap-4 border-border border-b px-4 py-3">
        <span className="font-medium text-foreground text-title tabular-nums">
          {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="text-body text-ink-3 tabular-nums">
          {formatClock((now - sessionStartedAt) / 1000)} elapsed
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="mb-2 font-semibold text-eyebrow text-ink-3 uppercase">Slide {index + 1}</p>
        {notes ? (
          <p className="whitespace-pre-wrap text-foreground text-lead">{notes}</p>
        ) : (
          <p className="text-body text-ink-3">No notes on this slide.</p>
        )}
      </div>

      {answers.length ? (
        <section
          aria-label="Answers"
          className="max-h-[40%] shrink-0 overflow-y-auto border-border border-t px-4 py-4"
        >
          <p className="mb-2 font-semibold text-eyebrow text-ink-3 uppercase">Answers</p>
          {state.answersHeld ? (
            <p role="status" className="mb-3 text-body text-foreground">
              Answers are teacher only. Turn on Show answers to present them.
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {answers.map((s) => (
              <li key={s.id} className="overflow-hidden rounded-card ring-1 ring-border">
                <SlideStatic slide={s} theme={theme} width={288} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="shrink-0 border-border border-t px-4 py-4">
        <p className="mb-2 font-semibold text-eyebrow text-ink-3 uppercase">
          {next ? "Next slide" : "Last slide"}
        </p>
        {next ? (
          <div className="overflow-hidden rounded-card ring-1 ring-border">
            <SlideStatic slide={next} theme={theme} width={288} />
          </div>
        ) : (
          <p className="text-body text-ink-3">End of the lesson.</p>
        )}
      </div>
    </aside>
  );
}
