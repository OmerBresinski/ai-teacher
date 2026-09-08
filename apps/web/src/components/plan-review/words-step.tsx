import { EditableListRow, QuestionShell } from "@tj/ui";
import { type Dispatch, useRef } from "react";
import { type PlanReviewAction, type PlanReviewState, VOCABULARY_MAX } from "@/lib/plan-review";
import { AddRowButton, arrive, markOf, useArrivalFocus } from "./shared";

export function WordsStep({
  state,
  dispatch,
}: {
  state: PlanReviewState;
  dispatch: Dispatch<PlanReviewAction>;
}) {
  const first = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useArrivalFocus(first);
  return (
    <QuestionShell
      eyebrow="3 of 5"
      question="Which words will they need?"
      help="Each word gets a definition in their language. Up to six; the vocabulary slide and the word bank follow."
    >
      <ol className="flex flex-col gap-2">
        {state.vocabulary.map((item, i) => (
          <EditableListRow
            key={item.id}
            mark={markOf(state, `vocabulary:${item.id}`)}
            field={{
              value: item.term,
              onChange: (term) => dispatch({ type: "editVocabulary", id: item.id, term }),
              label: `Term ${i + 1}`,
              placeholder: "The word",
              ref: i === 0 ? first : undefined,
            }}
            secondary={{
              value: item.definition,
              onChange: (definition) =>
                dispatch({ type: "editVocabulary", id: item.id, definition }),
              label: `Definition ${i + 1}`,
              placeholder: "What it means, in their words",
              multiline: true,
            }}
            onRemove={() => dispatch({ type: "removeVocabulary", id: item.id })}
            removeLabel={`Remove term ${i + 1}`}
            {...arrive(i)}
          />
        ))}
      </ol>
      <AddRowButton
        onClick={() => dispatch({ type: "addVocabulary" })}
        disabled={state.vocabulary.length >= VOCABULARY_MAX}
      >
        Add a word
      </AddRowButton>
    </QuestionShell>
  );
}
