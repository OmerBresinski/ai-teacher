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
import { useId, useLayoutEffect, useRef } from "react";
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
  return (
    <form
      className="creation-form"
      onSubmit={(event) => {
        event.preventDefault();
        onNext();
      }}
    >
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
      <ChoiceField
        label="Year group"
        value={brief.yearGroup}
        onChange={(yearGroup) => onChange({ ...brief, yearGroup })}
        options={[3, 4, 5, 6, 7, 8, 9, 10, 11].map((year) => ({
          value: `Year ${year}`,
          label: `Year ${year}`,
        }))}
      />
      <details className="creation-disclosure">
        <summary>Adjust the level</summary>
        <RadioGroup
          aria-label="Reading level"
          orientation="horizontal"
          className="creation-level-options"
          value={brief.level}
          onValueChange={(level) => onChange({ ...brief, level })}
        >
          {["easier", "standard", "harder"].map((level) => (
            <div key={level} className="creation-level-option">
              <RadioGroupItem id={`${id}-${level}`} value={level} className="sr-only" />
              <Label htmlFor={`${id}-${level}`} className="creation-level-pill">
                {level[0]?.toUpperCase()}
                {level.slice(1)}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </details>
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
      <p className="text-muted-foreground">
        {brief.topic} · {brief.yearGroup}
        {brief.level !== "standard"
          ? ` · ${brief.level === "easier" ? "Easier" : "Harder"} level`
          : ""}
      </p>
      <div className="creation-objectives">
        <p>By the end of the lesson, pupils can:</p>
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
          className="self-start"
          variant="link"
          disabled={objectives.length >= 4}
          onClick={() => onChange([...objectives, { id: crypto.randomUUID(), text: "" }])}
        >
          <Plus /> Add objective
        </Button>
      </div>
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
          Generate <ArrowRight />
        </Button>
        <Button variant="link" onClick={onBack}>
          <ArrowLeft /> Back to the brief
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
    <div className="creation-form">
      {worksheets.map((worksheet, index) => (
        <section
          className="creation-sheet"
          key={worksheet.id}
          aria-label={`Worksheet ${index + 1}`}
        >
          {worksheets.length > 1 ? (
            <div className="creation-sheet-heading">
              <span className="font-medium">Worksheet {index + 1}</span>
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
          <div className="creation-fields">
            <ChoiceField
              label="Activity type"
              value={worksheet.recipe}
              options={RECIPES}
              onChange={(recipe) =>
                onChange(
                  worksheets.map((item) => (item.id === worksheet.id ? { ...item, recipe } : item)),
                )
              }
            />
            <ChoiceField
              label="Practice time"
              value={worksheet.minutes}
              options={[5, 10, 15, 20, 30, 45].map((value) => ({
                value: String(value),
                label: `About ${value} minutes`,
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
        className="self-start"
        onClick={() =>
          onChange([
            ...worksheets,
            { id: crypto.randomUUID(), recipe: "exit-ticket", minutes: "5" },
          ])
        }
      >
        <Plus /> Add another worksheet
      </Button>
      <div className="creation-actions">
        <Button variant="inverse" onClick={onMake}>
          Make {worksheets.length > 1 ? `${worksheets.length} worksheets` : "worksheet"}{" "}
          <ArrowRight />
        </Button>
        <Button variant="link" onClick={onSkip}>
          Just the slides
        </Button>
      </div>
      <Button variant="link" className="self-start" onClick={onBack}>
        <ArrowLeft /> Back to objectives
      </Button>
    </div>
  );
}
