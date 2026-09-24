import {
  Button,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@tj/ui";
import { ArrowLeft, ArrowRight, Plus, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Field } from "@/components/brief/field";

export function ChoiceField({
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  compact?: boolean;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className={compact ? "creation-compact-choice" : undefined}>
      <Field id={id} label={label}>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

export type IntakeBrief = { topic: string; yearGroup: string; level: string; files: string[] };
export function BriefStep({
  brief,
  onChange,
  onNext,
  onSkip,
  filePicker,
}: {
  brief: IntakeBrief;
  onChange: (brief: IntakeBrief) => void;
  onNext: () => void;
  onSkip: () => void;
  filePicker?: React.ReactNode;
}) {
  const id = useId();
  const [levelOpen, setLevelOpen] = useState(false);
  return (
    <form
      className="creation-form"
      onSubmit={(event) => {
        event.preventDefault();
        onNext();
      }}
    >
      <div className="creation-brief-source">
        <Field id={id} label="Topic">
          <Textarea
            id={id}
            required
            rows={3}
            placeholder="What would you like to teach?"
            value={brief.topic}
            onChange={(event) => onChange({ ...brief, topic: event.target.value })}
          />
        </Field>
        {filePicker}
      </div>
      <ChoiceField
        label="Year group"
        value={brief.yearGroup}
        onChange={(yearGroup) => onChange({ ...brief, yearGroup })}
        options={[3, 4, 5, 6, 7, 8, 9, 10, 11].map((year) => ({
          value: `Year ${year}`,
          label: `Year ${year}`,
        }))}
      />
      <div className="creation-disclosure" data-open={levelOpen}>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="creation-disclosure-trigger"
          aria-expanded={levelOpen}
          aria-controls={`${id}-level-options`}
          onClick={() => setLevelOpen((open) => !open)}
        >
          Adjust the level <span aria-hidden="true">{levelOpen ? "−" : "+"}</span>
        </Button>
        <div
          id={`${id}-level-options`}
          className="creation-disclosure-content"
          aria-hidden={!levelOpen}
          inert={!levelOpen}
        >
          <div className="creation-disclosure-clip">
            <div className="creation-disclosure-inset">
              <RadioGroup
                aria-label="Reading level"
                orientation="horizontal"
                className="creation-level-options"
                value={brief.level}
                onValueChange={(level) => onChange({ ...brief, level })}
              >
                {["easier", "standard", "harder"].map((level) => (
                  <div key={level} className="creation-level-option">
                    <RadioGroupItem
                      id={`${id}-${level}`}
                      value={level}
                      className="sr-only"
                      onFocus={() => {
                        // Roving focus can arrive after keyup; selection follows the focused radio.
                        if (brief.level !== level) onChange({ ...brief, level });
                      }}
                    />
                    <Label htmlFor={`${id}-${level}`} className="creation-level-pill">
                      {level[0]?.toUpperCase()}
                      {level.slice(1)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </div>
        </div>
      </div>
      <div className="creation-actions">
        <Button variant="inverse" type="submit" disabled={!brief.topic.trim()}>
          Next <ArrowRight />
        </Button>
        <Button variant="link" disabled={!brief.topic.trim()} onClick={onSkip}>
          Skip planning
        </Button>
      </div>
    </form>
  );
}

function ObjectiveInput({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: remeasure the DOM after controlled text changes.
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "0px";
      input.style.height = `${input.scrollHeight}px`;
    };
    resize();
    // Only width changes need reflow; the callback itself changes height.
    let width = input.clientWidth;
    const widths = new ResizeObserver(() => {
      if (input.clientWidth !== width) {
        width = input.clientWidth;
        resize();
      }
    });
    widths.observe(input);
    return () => widths.disconnect();
  }, [value]);
  return (
    <Textarea
      ref={ref}
      className="creation-objective-input"
      aria-label={label}
      required
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export type ObjectiveDraft = { id: string; text: string };
export function ObjectivesStep({
  brief,
  objectives,
  onChange,
  slideCount,
  duration,
  onSlideCount,
  onDuration,
  onBack,
  onGenerate,
}: {
  brief: IntakeBrief;
  objectives: ObjectiveDraft[];
  onChange: (objectives: ObjectiveDraft[]) => void;
  slideCount: string;
  duration: string;
  onSlideCount: (value: string) => void;
  onDuration: (value: string) => void;
  onBack: () => void;
  onGenerate: () => void;
}) {
  return (
    <form
      className="creation-form"
      onSubmit={(event) => {
        event.preventDefault();
        onGenerate();
      }}
    >
      <p className="creation-step-context">
        {brief.topic} · {brief.yearGroup}
        {brief.level !== "standard"
          ? ` · ${brief.level === "easier" ? "Easier" : "Harder"} level`
          : ""}
      </p>
      <div className="creation-objectives">
        <p className="creation-objective-instruction">By the end of the lesson, pupils can:</p>
        {objectives.map((objective, index) => (
          <div key={objective.id} className="creation-objective">
            <span className="creation-objective-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <ObjectiveInput
              label={`Objective ${index + 1}`}
              value={objective.text}
              onChange={(text) =>
                onChange(
                  objectives.map((item) => (item.id === objective.id ? { ...item, text } : item)),
                )
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove objective ${index + 1}`}
              onClick={() => onChange(objectives.filter((item) => item.id !== objective.id))}
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          className="creation-add-action"
          variant="link"
          size="sm"
          disabled={objectives.length >= 4}
          onClick={() => onChange([...objectives, { id: crypto.randomUUID(), text: "" }])}
        >
          <Plus /> Add objective
        </Button>
      </div>
      <div className="creation-step-footer">
        <div className="creation-generation-options">
          <ChoiceField
            compact
            label="Slides"
            value={slideCount}
            onChange={onSlideCount}
            options={[6, 7, 8, 10, 12].map((value) => ({
              value: String(value),
              label: `${value} slides`,
            }))}
          />
          <ChoiceField
            compact
            label="Lesson length"
            value={duration}
            onChange={onDuration}
            options={[30, 45, 60, 90].map((value) => ({
              value: String(value),
              label: `${value} minutes`,
            }))}
          />
        </div>
        <div className="creation-actions">
          <Button
            variant="inverse"
            type="submit"
            disabled={!objectives.length || objectives.some((item) => !item.text.trim())}
          >
            Continue <ArrowRight />
          </Button>
        </div>
        <Button
          variant="link"
          size="sm"
          className="creation-back"
          aria-label="Back to the brief"
          onClick={onBack}
        >
          <ArrowLeft /> Back
        </Button>
      </div>
    </form>
  );
}

export type WorksheetDraft = { id: string; recipe: string; minutes: string };
const RECIPES = [
  { value: "knowledge-check", label: "Knowledge check" },
  { value: "exit-ticket", label: "Exit ticket" },
  { value: "cloze", label: "Fill the gaps" },
  { value: "matching", label: "Matching" },
  { value: "misconception-check", label: "Spot the misconception" },
  { value: "worked-example", label: "Worked example" },
  { value: "reading", label: "Reading comprehension" },
  { value: "word-search", label: "Word search" },
  { value: "exam-style", label: "Exam-style questions" },
];
export function WorksheetStep({
  worksheets,
  onChange,
  onBack,
  onMake,
  onSkip,
}: {
  worksheets: WorksheetDraft[];
  onChange: (worksheets: WorksheetDraft[]) => void;
  onBack: () => void;
  onMake: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="creation-form creation-worksheet-form">
      <div className="creation-worksheet-list">
        {worksheets.map((worksheet, index) => (
          <section
            className="creation-sheet"
            key={worksheet.id}
            aria-label={`Worksheet ${index + 1}`}
          >
            {worksheets.length > 1 ? (
              <div className="creation-sheet-heading">
                <span>Worksheet {index + 1}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove worksheet ${index + 1}`}
                  onClick={() => onChange(worksheets.filter((item) => item.id !== worksheet.id))}
                >
                  <X />
                </Button>
              </div>
            ) : null}
            <div className="creation-worksheet-fields">
              <ChoiceField
                label="Activity type"
                value={worksheet.recipe}
                options={RECIPES}
                onChange={(recipe) =>
                  onChange(
                    worksheets.map((item) =>
                      item.id === worksheet.id ? { ...item, recipe } : item,
                    ),
                  )
                }
              />
              <ChoiceField
                compact
                label="Practice time"
                value={worksheet.minutes}
                options={[5, 10, 15, 20, 30, 45].map((value) => ({
                  value: String(value),
                  label: `About ${value} min`,
                }))}
                onChange={(minutes) =>
                  onChange(
                    worksheets.map((item) =>
                      item.id === worksheet.id ? { ...item, minutes } : item,
                    ),
                  )
                }
              />
            </div>
          </section>
        ))}
        <Button
          variant="link"
          className="creation-add-action"
          size="sm"
          onClick={() =>
            onChange([
              ...worksheets,
              { id: crypto.randomUUID(), recipe: "exit-ticket", minutes: "5" },
            ])
          }
        >
          <Plus /> Add another worksheet
        </Button>
      </div>
      <div className="creation-step-footer">
        <div className="creation-actions">
          <Button variant="inverse" onClick={onMake}>
            Include {worksheets.length > 1 ? `${worksheets.length} worksheets` : "worksheet"}{" "}
            <ArrowRight />
          </Button>
          <Button variant="link" onClick={onSkip}>
            Just the slides
          </Button>
        </div>
        <Button
          variant="link"
          size="sm"
          className="creation-back"
          aria-label="Back to objectives"
          onClick={onBack}
        >
          <ArrowLeft /> Back
        </Button>
      </div>
    </div>
  );
}
