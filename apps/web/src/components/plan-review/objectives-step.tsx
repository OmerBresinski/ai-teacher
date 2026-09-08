import { EditableListRow, QuestionShell } from "@tj/ui";
import { type Dispatch, type KeyboardEvent, useRef } from "react";
import { OBJECTIVES_MAX, type PlanReviewAction, type PlanReviewState } from "@/lib/plan-review";
import { AddRowButton, arrive, markOf, useArrivalFocus, useArriveSettled } from "./shared";

export function ObjectivesStep({
  state,
  dispatch,
}: {
  state: PlanReviewState;
  dispatch: Dispatch<PlanReviewAction>;
}) {
  const first = useRef<HTMLTextAreaElement>(null);
  useArrivalFocus(first);
  const settled = useArriveSettled();
  const onKeyDown = (id: string) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      dispatch({ type: "moveObjective", id, delta: event.key === "ArrowUp" ? -1 : 1 });
    }
  };
  return (
    <QuestionShell
      question="What should pupils be able to do by the end?"
      help="One line each, up to four. Change a line and the objectives slide follows. Alt and an arrow key moves a line."
    >
      <ol className="flex flex-col gap-2">
        {state.objectives.map((objective, i) => (
          <EditableListRow
            key={objective.id}
            mark={markOf(state, `objective:${objective.id}`)}
            leading={
              <span className="w-5 text-center text-meta text-ink-3 tabular-nums">{i + 1}</span>
            }
            field={{
              value: objective.text,
              onChange: (text) => dispatch({ type: "editObjective", id: objective.id, text }),
              label: `Objective ${i + 1}`,
              placeholder: "What they will be able to do",
              ref: i === 0 ? first : undefined,
              onKeyDown: onKeyDown(objective.id),
            }}
            onRemove={
              state.objectives.length > 1
                ? () => dispatch({ type: "removeObjective", id: objective.id })
                : undefined
            }
            removeLabel={`Remove objective ${i + 1}`}
            {...arrive(i, settled)}
          />
        ))}
      </ol>
      <AddRowButton
        onClick={() => dispatch({ type: "addObjective" })}
        disabled={state.objectives.length >= OBJECTIVES_MAX}
      >
        Add an objective
      </AddRowButton>
    </QuestionShell>
  );
}
