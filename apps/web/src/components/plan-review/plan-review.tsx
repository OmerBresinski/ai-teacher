import type { Lesson, LessonFacts } from "@tj/domain/documents";
import { ActionBar, Button, Kbd, StepRail } from "@tj/ui";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import {
  factsOf,
  initPlanReview,
  PLAN_STEPS,
  type PlanReviewState,
  planReviewReducer,
  stepIndex,
  type WorksheetOutline,
} from "@/lib/plan-review";
import { ObjectivesStep } from "./objectives-step";
import { ShapeStep } from "./shape-step";
import { SummaryStep } from "./summary-step";
import { WordsStep } from "./words-step";
import { WorksheetStep } from "./worksheet-step";

/**
 * `/l/$lessonId` when the lesson is at `generation.stage: "planned"` and unlocked (Linear project
 * "Plan review"): one question per screen, the AI's proposal pre-filled and marked "suggested"
 * until touched, a step rail on the left, a sticky action bar with the one primary of the step
 * ("Continue", "Generate" on the summary), Enter to accept and continue (Cmd/Ctrl+Enter inside a
 * multi-line field), Escape to step back. Prototype: `onGenerate` receives the confirmed facts
 * and the worksheet outline; the page decides what to do with them (today: the cache, no API).
 */
export function PlanReview({
  lesson,
  facts,
  leading,
  onGenerate,
}: {
  lesson: Lesson;
  facts: LessonFacts;
  leading?: ReactNode;
  onGenerate: (facts: LessonFacts, worksheet: WorksheetOutline) => void;
}) {
  const [state, dispatch] = useReducer(planReviewReducer, facts, initPlanReview);
  const index = stepIndex(state.step);
  const step = PLAN_STEPS[index] ?? PLAN_STEPS[0];
  const first = state.step === "objectives";
  const last = state.step === "summary";
  const primaryRef = useRef<HTMLButtonElement>(null);

  // The summary has no control of its own: focus lands on Generate so Enter is the whole step.
  useEffect(() => {
    if (last) primaryRef.current?.focus();
  }, [last]);

  const advance = useCallback(() => {
    if (last) onGenerate(factsOf(state), state.worksheet);
    else dispatch({ type: "next" });
  }, [last, onGenerate, state]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (event.key === "Escape") {
      if (target.closest("[role=menu]")) return;
      event.preventDefault();
      dispatch({ type: "back" });
      return;
    }
    if (event.key !== "Enter") return;
    const meta = event.metaKey || event.ctrlKey;
    const tag = target.tagName;
    if (tag === "TEXTAREA" && !meta) return;
    if (tag === "BUTTON" || tag === "A" || target.closest("[role=menu],[role=menuitem]")) return;
    if (target.getAttribute("role") === "spinbutton" && !meta) return;
    event.preventDefault();
    advance();
  };

  return (
    <main className="min-h-dvh px-6 pt-8 lg:px-12" data-testid="plan-review">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex items-center gap-3">
          {leading}
          <div className="min-w-0">
            <p className="text-eyebrow font-semibold text-ink-3 uppercase tracking-wide">
              Plan review
            </p>
            <h1 className="truncate text-title font-semibold">{lesson.title}</h1>
          </div>
        </header>
        <div className="grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-[200px_minmax(0,1fr)]">
          <StepRail
            aria-label="Plan review steps"
            steps={PLAN_STEPS}
            current={state.step}
            done={state.done}
            onSelect={(id) => dispatch({ type: "go", step: id as PlanReviewState["step"] })}
            className="md:sticky md:top-8 md:self-start"
          />
          <output aria-live="polite" className="sr-only">
            Step {index + 1} of {PLAN_STEPS.length}: {step.label}
          </output>
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: keyboard shortcuts for the whole step; every control inside is focusable */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: same */}
          <div onKeyDown={onKeyDown} className="flex max-w-2xl flex-col gap-6">
            {state.step === "objectives" ? (
              <ObjectivesStep key="objectives" state={state} dispatch={dispatch} />
            ) : state.step === "shape" ? (
              <ShapeStep key="shape" state={state} dispatch={dispatch} />
            ) : state.step === "words" ? (
              <WordsStep key="words" state={state} dispatch={dispatch} />
            ) : state.step === "worksheet" ? (
              <WorksheetStep key="worksheet" state={state} dispatch={dispatch} />
            ) : (
              <SummaryStep key="summary" state={state} lesson={lesson} />
            )}
            <ActionBar
              primary={
                <Button size="lg" ref={primaryRef} onClick={advance}>
                  {last ? "Generate" : "Continue"}
                </Button>
              }
              trailing={
                <span className="flex items-center gap-2 text-meta text-ink-3">
                  <Kbd>Enter</Kbd> {last ? "generates" : "continues"}
                  {first ? null : (
                    <>
                      <Kbd>Esc</Kbd> goes back
                    </>
                  )}
                </span>
              }
            >
              {first ? (
                <Button variant="secondary" onClick={() => dispatch({ type: "acceptAll" })}>
                  Looks right, generate
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => dispatch({ type: "back" })}>
                  Back
                </Button>
              )}
            </ActionBar>
          </div>
        </div>
      </div>
    </main>
  );
}
