import {
  DEFAULT_SHEET_RECIPE_ID,
  OFFERED_RECIPE_IDS,
  offeredForYear,
  recogniseYearGroup,
  SLIDE_TIER_RANGES,
  SLIDE_TIERS,
  type SlideSheetRecipeId,
  type SlideTier,
  YEAR_GROUP_PLACEHOLDER,
  YEAR_GROUPS,
  type YearGroupProblem,
  yearGroupMessage,
  yearGroupProblem,
  yearMentionKey,
  yearNumberOf,
} from "@tj/domain/documents";
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
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Field } from "@/components/brief/field";

/**
 * Ruling 164: the teacher picks a size; the writer picks the count inside it. Sizes, not minutes
 * (Greg, 12 Nov 2026: "dont promise minutes"): the helper says only the slides the size makes. The
 * stored tier ids stay `quick` / `standard` / `detailed`.
 */
const TIER_NAMES: Record<SlideTier, string> = {
  quick: "Short",
  standard: "Standard",
  detailed: "Long",
};
export const SLIDE_TIER_OPTIONS = SLIDE_TIERS.map((tier) => ({
  value: tier,
  label: TIER_NAMES[tier],
  hint: `${SLIDE_TIER_RANGES[tier].min} to ${SLIDE_TIER_RANGES[tier].max} slides`,
}));

/**
 * The intake's year groups: the shared list's numbered years, Year 1 to Year 13, so KS1 and the
 * sixth form reach the writer's KS1 and KS5 bundles. Reception is left out: the writer has no
 * EYFS bundle (an `eyfs` lesson is written as KS1) and `writerBrief` reads its year as 7.
 */
export const YEAR_GROUP_OPTIONS = YEAR_GROUPS.filter(
  (year) => yearNumberOf(year) !== undefined,
).map((year) => ({ value: year, label: year }));

export function ChoiceField({
  label,
  value,
  options,
  onChange,
  compact = false,
  placeholder,
  error,
  triggerRef,
}: {
  compact?: boolean;
  label: string;
  value: string;
  /** Shown while nothing is chosen (`value` is ""). */
  placeholder?: string;
  /** The field's error line, tied to the control by `aria-describedby`. */
  error?: string;
  triggerRef?: React.Ref<HTMLButtonElement>;
  /** An option's `hint` is its plain helper, shown muted after the label. */
  options: readonly { value: string; label: string; hint?: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className={compact ? "creation-compact-choice" : undefined}>
      <Field id={id} label={label}>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger
            id={id}
            ref={triggerRef}
            className="w-full"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                  {option.hint ? (
                    // The space reads between the two for a screen reader; flex drops it visually.
                    <>
                      {" "}
                      <span className="text-ink-3">{option.hint}</span>
                    </>
                  ) : null}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-meta text-destructive">
            {error}
          </p>
        ) : null}
      </Field>
    </div>
  );
}

export type IntakeBrief = {
  topic: string;
  /** "" until the teacher chooses (founder's ruling, 12 Nov 2026: no preset year group). */
  yearGroup: string;
  level: string;
  files: string[];
  /**
   * The topic's year mentions (`yearMentionKey`) when the teacher answered the year-group
   * question for them: the answer holds while the topic names the same years.
   */
  yearConfirmedFor?: string;
};

/** Whether the teacher has answered the year-group question for the topic as it now reads. */
export const yearConfirmed = (brief: IntakeBrief) =>
  brief.yearConfirmedFor !== undefined && brief.yearConfirmedFor === yearMentionKey(brief.topic);

/** What the brief's year group needs before planning can start; undefined when it can go. */
export const briefYearProblem = (brief: IntakeBrief) =>
  yearGroupProblem(brief.yearGroup, brief.topic, yearConfirmed(brief));
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
  /** Absent once a plan exists: a changed brief has to be replanned before it can generate. */
  onSkip?: () => void;
  filePicker?: React.ReactNode;
}) {
  const id = useId();
  const [levelOpen, setLevelOpen] = useState(false);
  // Founder's ruling (12 Nov 2026): a year group the list does not have is asked, never guessed.
  // A stored one that is not on the list (an older lesson's "P5") asks at once; the rest on Next.
  const [yearAsk, setYearAsk] = useState<YearGroupProblem | undefined>(() => {
    const problem = briefYearProblem(brief);
    return problem?.reason === "unrecognised" ? problem : undefined;
  });
  const yearTrigger = useRef<HTMLButtonElement>(null);
  /** Runs `next` when the year group can go; else asks, keeping everything the teacher typed. */
  const go = (next: () => void) => {
    const problem = briefYearProblem(brief);
    if (problem === undefined) return next();
    setYearAsk(problem);
    // A topic naming another year: the teacher picks again, so the choice is theirs, not ours.
    if (problem.reason === "conflict") onChange({ ...brief, yearGroup: "" });
    yearTrigger.current?.focus();
  };
  return (
    <form
      className="creation-form"
      onSubmit={(event) => {
        event.preventDefault();
        go(onNext);
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
        value={recogniseYearGroup(brief.yearGroup) ?? ""}
        placeholder={YEAR_GROUP_PLACEHOLDER}
        error={yearAsk ? yearGroupMessage(yearAsk) : undefined}
        triggerRef={yearTrigger}
        onChange={(yearGroup) => {
          // A pick made in answer to the question settles it for the topic's year mentions.
          const answered = yearAsk?.reason === "conflict" ? yearMentionKey(brief.topic) : undefined;
          onChange({ ...brief, yearGroup, yearConfirmedFor: answered ?? brief.yearConfirmedFor });
          setYearAsk(undefined);
        }}
        options={YEAR_GROUP_OPTIONS}
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
        {onSkip ? (
          <Button variant="link" disabled={!brief.topic.trim()} onClick={() => go(onSkip)}>
            Skip planning
          </Button>
        ) : null}
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
      maxLength={300}
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
  slideTier,
  onSlideTier,
  onBack,
  onGenerate,
}: {
  brief: IntakeBrief;
  objectives: ObjectiveDraft[];
  onChange: (objectives: ObjectiveDraft[]) => void;
  slideTier: SlideTier;
  duration?: string;
  onSlideTier: (value: SlideTier) => void;
  onDuration?: (value: string) => void;
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
          aria-label={
            objectives.length >= 4 ? "Add objective — maximum 4 objectives reached" : undefined
          }
          onClick={() => onChange([...objectives, { id: crypto.randomUUID(), text: "" }])}
        >
          <Plus /> Add objective
        </Button>
      </div>
      <div className="creation-step-footer">
        <div className="creation-generation-options">
          <ChoiceField
            compact
            label="Lesson size"
            value={slideTier}
            onChange={(value) => onSlideTier(value as SlideTier)}
            options={SLIDE_TIER_OPTIONS}
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
/** The launch types' picker labels (worksheets plan v2 §2); only the offered ones show. */
const SHEET_TYPE_LABELS: Record<SlideSheetRecipeId, string> = {
  practice: "Practice",
  "quick-quiz": "Quick quiz",
  "key-words": "Key words",
  "exit-ticket": "Exit ticket",
  "exam-style": "Exam practice",
};
// The old seven stay parseable but are no longer offered (plan v2 T6). Exam practice shows for
// Years 10 and 11 only (T7).
const recipesFor = (yearGroup: string | undefined) =>
  OFFERED_RECIPE_IDS.filter((value) => offeredForYear(value, yearNumberOf(yearGroup))).map(
    (value) => ({ value, label: SHEET_TYPE_LABELS[value] }),
  );
/**
 * R4 review (12 Nov), web finding 8: a draft whose type the year no longer offers (Exam practice
 * after the year is lowered below 10) goes back to Practice, so the picker never shows a blank and
 * the request never posts a hidden type. The same array when nothing changes.
 */
export function draftsForYear(
  worksheets: WorksheetDraft[],
  yearGroup: string | undefined,
): WorksheetDraft[] {
  const offered = new Set<string>(recipesFor(yearGroup).map((option) => option.value));
  if (worksheets.every((item) => offered.has(item.recipe))) return worksheets;
  return worksheets.map((item) =>
    offered.has(item.recipe) ? item : { ...item, recipe: DEFAULT_SHEET_RECIPE_ID },
  );
}

export function WorksheetStep({
  worksheets,
  yearGroup,
  maxWorksheets = Infinity,
  onChange,
  onBack,
  onMake,
  onSkip,
}: {
  worksheets: WorksheetDraft[];
  /** The brief's year group: Exam practice is offered to Years 10 and 11 only. */
  yearGroup?: string;
  maxWorksheets?: number;
  onChange: (worksheets: WorksheetDraft[]) => void;
  onBack: () => void;
  onMake: () => void;
  onSkip: () => void;
}) {
  useEffect(() => {
    const next = draftsForYear(worksheets, yearGroup);
    if (next !== worksheets) onChange(next);
  }, [worksheets, yearGroup, onChange]);
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
                options={recipesFor(yearGroup)}
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
        {worksheets.length < maxWorksheets ? (
          <Button
            variant="link"
            className="creation-add-action"
            size="sm"
            onClick={() =>
              onChange([
                ...worksheets,
                { id: crypto.randomUUID(), recipe: "practice", minutes: "15" },
              ])
            }
          >
            <Plus /> Add another worksheet
          </Button>
        ) : null}
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
