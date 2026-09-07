import { Button, Label, RadioGroup, RadioGroupItem } from "@tj/ui";
import { useId } from "react";
import type { Answer } from "@/lib/brief-form";
import type { BriefOption, BriefQuestion } from "@/lib/brief-questions";

/** One clarifying question: a radio group with the first option pre-selected, and a Skip toggle. */
export function QuestionBlock({
  question,
  options,
  answer,
  onChange,
}: {
  question: BriefQuestion;
  options: BriefOption[];
  answer: Answer;
  onChange: (next: Answer) => void;
}) {
  const baseId = useId();
  const selected = options[answer.index] ?? options[0];
  return (
    <fieldset className="flex flex-col gap-2 rounded-card border border-border-control/40 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <legend className="text-body font-semibold text-foreground">{question.prompt}</legend>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={answer.skipped}
          onClick={() => onChange({ ...answer, skipped: !answer.skipped })}
        >
          {answer.skipped ? "Answer" : "Skip"}
        </Button>
      </div>
      {answer.skipped ? (
        <p className="text-meta text-ink-3">Skipped — the plan decides.</p>
      ) : (
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
          className="gap-2"
        >
          {options.map((option, index) => {
            const id = `${baseId}-${index}`;
            return (
              <div key={option.value} className="flex items-center gap-2">
                <RadioGroupItem id={id} value={option.value} />
                <Label htmlFor={id} className="!text-foreground font-normal">
                  {option.label}
                </Label>
              </div>
            );
          })}
        </RadioGroup>
      )}
    </fieldset>
  );
}
