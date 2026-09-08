import { GENERATABLE_SLIDE_KINDS } from "@tj/domain/documents";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EditableListRow,
  MinutesStepper,
  QuestionShell,
} from "@tj/ui";
import { GripVertical } from "lucide-react";
import { type Dispatch, type KeyboardEvent, useRef } from "react";
import { useRowDrag } from "@/hooks/use-row-drag";
import {
  PHASES_MAX,
  type PlanReviewAction,
  type PlanReviewState,
  SLIDE_KIND_LABELS,
  totalMinutes,
} from "@/lib/plan-review";
import { AddRowButton, arrive, markOf, useArrivalFocus } from "./shared";

/** Row pitch for the drag hook: a 48px row plus the 8px gap. */
const ROW_HEIGHT = 56;

export function ShapeStep({
  state,
  dispatch,
}: {
  state: PlanReviewState;
  dispatch: Dispatch<PlanReviewAction>;
}) {
  const first = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useArrivalFocus(first);
  const total = totalMinutes(state);
  const planned = state.base.durationMin;
  const { drag, listRef, gripProps } = useRowDrag({
    rowHeight: ROW_HEIGHT,
    count: state.phases.length,
    onDrop: (from, insertion) =>
      dispatch({ type: "movePhase", from, to: insertion > from ? insertion - 1 : insertion }),
  });
  const onKeyDown = (id: string) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      dispatch({ type: "movePhaseBy", id, delta: event.key === "ArrowUp" ? -1 : 1 });
    }
  };
  const difference = total - planned;
  // The running total against the brief's duration (audit §5, "Total"): warning when they differ.
  const totalLine =
    difference === 0
      ? `${total} of ${planned} minutes.`
      : difference > 0
        ? `${total} of ${planned} minutes: ${difference} over. Trim a phase or change a number.`
        : `${total} of ${planned} minutes: ${-difference} spare. Add a phase or give one more time.`;

  return (
    <QuestionShell
      eyebrow="2 of 5"
      question="Does the shape of the lesson look right?"
      help="Each row is one slide. Drag the handle or use Alt and an arrow key to move a phase; change the minutes with the stepper."
    >
      <ol ref={listRef} className="relative flex flex-col gap-2">
        {state.phases.map((phase, i) => {
          const grip = gripProps(i);
          return (
            <EditableListRow
              key={phase.id}
              mark={markOf(state, `phase:${phase.id}`)}
              data-dragging={drag.from === i ? "" : undefined}
              leading={
                <>
                  <button
                    type="button"
                    aria-label={`Move ${SLIDE_KIND_LABELS[phase.kind]}, phase ${i + 1} of ${state.phases.length}`}
                    className="flex size-8 cursor-grab items-center justify-center rounded-control text-ink-3 outline-none hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
                    {...grip}
                    onKeyDown={(event) => {
                      grip.onKeyDown?.(event);
                      onKeyDown(phase.id)(event);
                    }}
                  >
                    <GripVertical aria-hidden size={16} strokeWidth={1.5} />
                  </button>
                  <span className="w-28 truncate text-meta font-medium text-ink-2">
                    {SLIDE_KIND_LABELS[phase.kind]}
                  </span>
                </>
              }
              field={{
                value: phase.summary,
                onChange: (summary) => dispatch({ type: "editPhase", id: phase.id, summary }),
                label: `${SLIDE_KIND_LABELS[phase.kind]} summary`,
                placeholder: "One line on what this slide covers",
                ref: i === 0 ? first : undefined,
                onKeyDown: onKeyDown(phase.id),
              }}
              trailing={
                <MinutesStepper
                  value={phase.minutes}
                  onChange={(minutes) => dispatch({ type: "editPhase", id: phase.id, minutes })}
                  label={`Minutes for ${SLIDE_KIND_LABELS[phase.kind]}`}
                  max={180}
                />
              }
              onRemove={
                state.phases.length > 2
                  ? () => dispatch({ type: "removePhase", id: phase.id })
                  : undefined
              }
              removeLabel={`Remove ${SLIDE_KIND_LABELS[phase.kind]}`}
              {...arrive(i)}
              style={{
                ...arrive(i).style,
                opacity: drag.from === i ? 0.4 : undefined,
              }}
            />
          );
        })}
        {drag.insertion !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 left-0 h-0.5 rounded-full bg-primary"
            style={{ top: drag.insertion * ROW_HEIGHT - 5 }}
          />
        ) : null}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <AddRowButton onClick={() => {}} disabled={state.phases.length >= PHASES_MAX}>
              Add a phase
            </AddRowButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            {GENERATABLE_SLIDE_KINDS.map((kind) => (
              <DropdownMenuItem key={kind} onSelect={() => dispatch({ type: "addPhase", kind })}>
                {SLIDE_KIND_LABELS[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <p
          role="status"
          className={cn(
            "text-meta tabular-nums",
            difference === 0 ? "text-ink-3" : "font-medium text-warning",
          )}
        >
          {totalLine}
        </p>
      </div>
    </QuestionShell>
  );
}
