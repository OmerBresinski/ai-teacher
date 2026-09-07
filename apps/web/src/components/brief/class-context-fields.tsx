import { findNamePatterns, NEED_CATEGORIES, SIZE_BANDS, type SizeBand } from "@tj/domain/documents";
import { Button, Input, Label, RadioGroup, RadioGroupItem, Textarea } from "@tj/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId } from "react";
import { type BriefState, NEED_LABELS, SIZE_BAND_LABELS } from "@/lib/brief-form";
import { Field, GuardHint } from "./field";

const OPEN_ICON = <ChevronDown aria-hidden size={16} strokeWidth={1.5} />;
const CLOSED_ICON = <ChevronRight aria-hidden size={16} strokeWidth={1.5} />;

/**
 * The optional class context (ADR 0024 §2) behind a disclosure: size band, need counts, prior
 * knowledge and notes. Both text fields run the identifier guard once they have been blurred.
 */
export function ClassContextFields({
  state,
  touched,
  onChange,
  onBlur,
}: {
  state: BriefState;
  touched: ReadonlySet<string>;
  onChange: (change: Partial<BriefState>) => void;
  onBlur: (field: "priorKnowledge" | "notes") => void;
}) {
  const sectionId = useId();
  const sizeBandId = useId();
  const priorId = useId();
  const notesId = useId();
  // The guard speaks once a field has been left, not while it is being typed into.
  const priorHit =
    touched.has("priorKnowledge") && findNamePatterns(state.priorKnowledge).length > 0;
  const notesHit = touched.has("notes") && findNamePatterns(state.notes).length > 0;

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        aria-expanded={state.classOpen}
        aria-controls={sectionId}
        onClick={() => onChange({ classOpen: !state.classOpen })}
      >
        {state.classOpen ? OPEN_ICON : CLOSED_ICON}
        {state.classOpen ? "Class context" : "Add class context"}
      </Button>
      {state.classOpen ? (
        <div
          id={sectionId}
          className="flex flex-col gap-4 rounded-card border border-border-control/40 bg-card p-4"
        >
          <p className="text-meta text-ink-3">
            About the class as a group — never about a pupil. No names, no rosters.
          </p>
          <div className="flex flex-col gap-1.5">
            <span id={sizeBandId} className="text-body font-medium text-foreground">
              Class size
            </span>
            <RadioGroup
              aria-labelledby={sizeBandId}
              value={state.sizeBand}
              onValueChange={(value) => onChange({ sizeBand: value as SizeBand })}
              className="flex flex-wrap gap-4"
            >
              {SIZE_BANDS.map((band) => (
                <div key={band} className="flex items-center gap-2">
                  <RadioGroupItem id={`${sizeBandId}-${band}`} value={band} />
                  <Label htmlFor={`${sizeBandId}-${band}`} className="!text-foreground font-normal">
                    {SIZE_BAND_LABELS[band]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-body font-medium text-foreground">
              Needs (number of pupils)
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {NEED_CATEGORIES.map((category) => (
                <Field
                  key={category}
                  id={`${sizeBandId}-need-${category}`}
                  label={NEED_LABELS[category]}
                >
                  <Input
                    id={`${sizeBandId}-need-${category}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={99}
                    value={state.needs[category] ?? ""}
                    onChange={(event) =>
                      onChange({ needs: { ...state.needs, [category]: event.target.value } })
                    }
                  />
                </Field>
              ))}
            </div>
          </fieldset>
          <Field
            id={priorId}
            label="What the class already knows"
            hint={
              priorHit ? (
                <GuardHint id={`${priorId}-hint`} text={state.priorKnowledge} />
              ) : undefined
            }
          >
            <Textarea
              id={priorId}
              rows={2}
              value={state.priorKnowledge}
              onChange={(event) => onChange({ priorKnowledge: event.target.value })}
              onBlur={() => onBlur("priorKnowledge")}
              aria-invalid={priorHit || undefined}
              aria-describedby={priorHit ? `${priorId}-hint` : undefined}
              placeholder="Can find a half and a quarter of a shape"
            />
          </Field>
          <Field
            id={notesId}
            label="Notes"
            hint={notesHit ? <GuardHint id={`${notesId}-hint`} text={state.notes} /> : undefined}
          >
            <Textarea
              id={notesId}
              rows={2}
              value={state.notes}
              onChange={(event) => onChange({ notes: event.target.value })}
              onBlur={() => onBlur("notes")}
              aria-invalid={notesHit || undefined}
              aria-describedby={notesHit ? `${notesId}-hint` : undefined}
              placeholder="Lively after lunch; several pupils need extra time to write"
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}
