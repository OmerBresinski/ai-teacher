import { Button, Label, RadioGroup, RadioGroupItem, StatusPill } from "@tj/ui";
import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import { type Answer, answerIndex } from "@/lib/brief-form";
import type { BriefOption, BriefQuestion } from "@/lib/brief-questions";

/**
 * One clarifying question, asked on its own (TEACH-177 item 3). Open: the question as a full
 * sentence, the options as a verb with a one-line gloss, the pre-chosen one marked "suggested"
 * (`StatusPill`, ruling 36). Enter or Accept settles it and the page reveals the next question;
 * Skip settles it as skipped. Settled: one line with the answer and a Change button, so the
 * teacher can reopen it. A newly revealed question arrives with the kit's rise-and-fade.
 */
export function QuestionBlock({
  question,
  options,
  answer,
  suggestedIndex,
  done,
  autoFocus,
  onChange,
  onAccept,
  onReopen,
}: {
  question: BriefQuestion;
  options: BriefOption[];
  answer: Answer;
  /** The option the form pre-selects; carries the "suggested" pill. */
  suggestedIndex: number;
  /** Settled (accepted or skipped): rendered as one line with Change. */
  done: boolean;
  /** Move focus to the selected option when the question is revealed by a keypress. */
  autoFocus?: boolean;
  onChange: (next: Answer) => void;
  onAccept: () => void;
  onReopen: () => void;
}) {
  const baseId = useId();
  const root = useRef<HTMLFieldSetElement>(null);
  const index = answerIndex(answer, suggestedIndex);
  const selected = options[index] ?? options[0];

  useEffect(() => {
    if (!autoFocus || done) return;
    root.current?.querySelector<HTMLElement>('[role="radio"][data-state="checked"]')?.focus();
  }, [autoFocus, done]);

  if (done) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-card border border-border-control/40 bg-card px-4 py-2.5"
        data-testid={`question-${question.id}-done`}
      >
        <p className="text-body text-foreground">
          <span className="text-ink-3">{question.prompt} </span>
          <span className="font-medium">
            {answer.skipped ? "Skipped — the plan decides." : selected?.label}
          </span>
        </p>
        <Button type="button" variant="ghost" onClick={onReopen}>
          Change
        </Button>
      </div>
    );
  }

  const onRadioKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Enter on a radio would submit the form; here it accepts the answer instead.
    if (event.key !== "Enter") return;
    event.preventDefault();
    onAccept();
  };

  return (
    <fieldset
      ref={root}
      className="flex flex-col gap-3 rounded-card border border-border-control/40 bg-card p-4 motion-safe:animate-arrive"
      data-testid={`question-${question.id}`}
    >
      {/* Wrapped so the browser lays the legend out as a block, not on the border. */}
      <div>
        <legend className="text-body font-semibold text-foreground">{question.prompt}</legend>
      </div>
      <RadioGroup
        aria-label={question.prompt}
        value={selected?.value ?? ""}
        onValueChange={(value) =>
          onChange({
            skipped: false,
            index: Math.max(
              0,
              options.findIndex((o) => o.value === value),
            ),
          })
        }
        className="gap-2.5"
      >
        {options.map((option, optionIndex) => {
          const id = `${baseId}-${optionIndex}`;
          const suggested = optionIndex === suggestedIndex;
          return (
            <div key={option.value} className="grid grid-cols-[auto_1fr] items-start gap-x-2">
              <RadioGroupItem
                id={id}
                value={option.value}
                className="mt-0.5"
                onKeyDown={onRadioKeyDown}
                aria-describedby={`${id}-gloss${suggested ? ` ${id}-suggested` : ""}`}
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Label htmlFor={id} className="!text-foreground font-normal">
                  {option.label}
                </Label>
                {suggested ? (
                  <StatusPill id={`${id}-suggested`} tone="accent">
                    suggested
                  </StatusPill>
                ) : null}
                <p id={`${id}-gloss`} className="basis-full text-meta text-ink-3">
                  {option.gloss}
                </p>
              </div>
            </div>
          );
        })}
      </RadioGroup>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={onAccept}>
          Accept
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onChange({ ...answer, skipped: true });
            onAccept();
          }}
        >
          Skip
        </Button>
        <span className="text-meta text-ink-3">Enter accepts.</span>
      </div>
    </fieldset>
  );
}
