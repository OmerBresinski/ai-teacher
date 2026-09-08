import { GENERATABLE_SLIDE_KINDS, type Lesson, type LessonFacts } from "@tj/domain/documents";
import {
  ActionBar,
  Button,
  cn,
  Display,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EditableListRow,
  Input,
  Kbd,
  Label,
  MinutesStepper,
  PhaseStrip,
  StatusPill,
  Switch,
} from "@tj/ui";
import { X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  factsOf,
  initPlanReview,
  isSectionYours,
  OBJECTIVES_MAX,
  PHASES_MAX,
  type PlanReviewAction,
  type PlanReviewState,
  planReviewReducer,
  SECTIONS,
  type SectionId,
  SLIDE_KIND_LABELS,
  sectionsYours,
  TIER_LABELS,
  TIERS,
  totalMinutes,
  VOCABULARY_MAX,
  type WorksheetOutline,
} from "@/lib/plan-review";
import { AddRowButton, arrive, useArriveSettled } from "./shared";

/**
 * `/l/$lessonId` when the lesson is at `generation.stage: "planned"` and unlocked (Linear project
 * "Plan review"): one screen, the building blocks of the plan and none of the content. Four
 * sections (objectives as editable lines, the shape as a strip of phase blocks, the words as
 * chips, the worksheet as a switch with tiers), each "suggested" until the teacher touches it and
 * "yours" after, and one sticky action bar whose primary is Generate. Cmd/Ctrl+Enter generates
 * from anywhere; Enter on a phase block opens its minutes, Escape closes them. Prototype:
 * `onGenerate` receives the confirmed facts and the worksheet outline; the page decides what to
 * do with them (today: the cache, no API).
 */
export function PlanReview({
  lesson,
  facts,
  leading,
  onGenerate,
  onBackToBrief,
}: {
  lesson: Lesson;
  facts: LessonFacts;
  leading?: ReactNode;
  onGenerate: (facts: LessonFacts, worksheet: WorksheetOutline) => void;
  onBackToBrief: () => void;
}) {
  const [state, dispatch] = useReducer(planReviewReducer, facts, initPlanReview);
  const settled = useArriveSettled();
  const yours = sectionsYours(state);
  const generate = useCallback(
    () => onGenerate(factsOf(state), state.worksheet),
    [onGenerate, state],
  );
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      generate();
    }
  };
  const labels = SECTIONS.filter((section) => yours.includes(section.id)).map((s) => s.label);
  const count =
    yours.length === 0
      ? "Everything is as suggested."
      : yours.length === 1
        ? `1 section is yours: ${labels[0]}.`
        : `${yours.length} sections are yours: ${listOf(labels)}.`;
  const who = lesson.yearGroup ? ` for ${lesson.yearGroup}` : "";

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Cmd+Enter generates from anywhere on the page; every control is focusable
    <main className="min-h-dvh px-6 pt-8 lg:px-12" data-testid="plan-review" onKeyDown={onKeyDown}>
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="flex items-start gap-3">
          {leading}
          <div className="min-w-0">
            <p className="text-eyebrow font-semibold text-ink-3 uppercase tracking-wide">
              Plan review
            </p>
            <Display as="h1" size="lg" className="mt-1">
              {lesson.title}, {state.base.durationMin} minutes{who}
            </Display>
            <p className="mt-2 text-lead text-ink-2">
              Here is the shape of the lesson. Change anything, then generate.
            </p>
          </div>
        </header>
        <output aria-live="polite" className="sr-only">
          {count}
        </output>
        <div className="flex flex-col gap-8">
          <Section id="objectives" state={state} index={0} settled={settled}>
            <Objectives state={state} dispatch={dispatch} />
          </Section>
          <Section id="shape" state={state} index={1} settled={settled}>
            <Shape state={state} dispatch={dispatch} />
          </Section>
          <Section id="words" state={state} index={2} settled={settled}>
            <Words state={state} dispatch={dispatch} />
          </Section>
          <Section id="worksheet" state={state} index={3} settled={settled}>
            <Worksheet state={state} dispatch={dispatch} />
          </Section>
        </div>
        <p className="text-meta text-ink-2" data-testid="yours-count">
          {count}
        </p>
        <ActionBar
          primary={
            <Button size="lg" onClick={generate}>
              Generate
            </Button>
          }
          trailing={
            <span className="flex items-center gap-2 text-meta text-ink-3">
              <Kbd>⌘</Kbd>
              <Kbd>Enter</Kbd> generates
            </span>
          }
        >
          <Button variant="ghost" onClick={onBackToBrief}>
            Back to the brief
          </Button>
        </ActionBar>
      </div>
    </main>
  );
}

const listOf = (items: string[]) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function Section({
  id,
  state,
  index,
  settled,
  children,
}: {
  id: SectionId;
  state: PlanReviewState;
  index: number;
  settled: boolean;
  children: ReactNode;
}) {
  const headingId = useId();
  const yours = isSectionYours(state, id);
  const label = SECTIONS.find((section) => section.id === id)?.label ?? id;
  return (
    <section
      aria-labelledby={headingId}
      data-section={id}
      data-yours={yours ? "" : undefined}
      className={cn("flex flex-col gap-3", arrive(index, settled).className)}
      style={arrive(index, settled).style}
    >
      <div className="flex items-center gap-3">
        <h2 id={headingId} className="text-title font-semibold">
          {label}
        </h2>
        {yours ? (
          <StatusPill tone="accent" opaque dot>
            Yours
          </StatusPill>
        ) : (
          <StatusPill tone="neutral">Suggested</StatusPill>
        )}
      </div>
      {children}
    </section>
  );
}

type Part = { state: PlanReviewState; dispatch: (action: PlanReviewAction) => void };

function Objectives({ state, dispatch }: Part) {
  return (
    <>
      <ol className="flex flex-col gap-2">
        {state.objectives.map((objective, i) => (
          <EditableListRow
            key={objective.id}
            leading={
              <span className="w-5 text-center text-meta text-ink-3 tabular-nums">{i + 1}</span>
            }
            field={{
              value: objective.text,
              onChange: (text) => dispatch({ type: "editObjective", id: objective.id, text }),
              label: `Objective ${i + 1}`,
              placeholder: "What they will be able to do",
              onKeyDown: (event) => {
                if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                  event.preventDefault();
                  dispatch({
                    type: "moveObjective",
                    id: objective.id,
                    delta: event.key === "ArrowUp" ? -1 : 1,
                  });
                }
              },
            }}
            onRemove={
              state.objectives.length > 1
                ? () => dispatch({ type: "removeObjective", id: objective.id })
                : undefined
            }
            removeLabel={`Remove objective ${i + 1}`}
          />
        ))}
      </ol>
      <AddRowButton
        onClick={() => dispatch({ type: "addObjective" })}
        disabled={state.objectives.length >= OBJECTIVES_MAX}
      >
        Add an objective
      </AddRowButton>
    </>
  );
}

function Shape({ state, dispatch }: Part) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = state.phases.find((phase) => phase.id === selectedId) ?? null;
  const total = totalMinutes(state);
  const planned = state.base.durationMin;
  const difference = total - planned;
  const totalLine =
    difference === 0
      ? `${total} of ${planned} minutes`
      : difference > 0
        ? `${total} of ${planned} minutes, ${difference} over`
        : `${total} of ${planned} minutes, ${-difference} spare`;
  return (
    <>
      <PhaseStrip
        label="Phases"
        phases={state.phases.map((phase) => ({
          id: phase.id,
          label: SLIDE_KIND_LABELS[phase.kind],
          minutes: phase.minutes,
        }))}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={(from, to) => dispatch({ type: "movePhase", from, to })}
        detail={
          selected ? (
            <PhaseDetail
              key={selected.id}
              label={SLIDE_KIND_LABELS[selected.kind]}
              minutes={selected.minutes}
              onMinutes={(minutes) => dispatch({ type: "editPhase", id: selected.id, minutes })}
              onRemove={
                state.phases.length > 2
                  ? () => {
                      setSelectedId(null);
                      dispatch({ type: "removePhase", id: selected.id });
                    }
                  : undefined
              }
            />
          ) : null
        }
      />
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
    </>
  );
}

function PhaseDetail({
  label,
  minutes,
  onMinutes,
  onRemove,
}: {
  label: string;
  minutes: number;
  onMinutes: (minutes: number) => void;
  onRemove?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Enter on the block opened this: the stepper takes focus so the arrows change the minutes.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=spinbutton]")?.focus();
  }, []);
  return (
    <div ref={ref} className="flex flex-wrap items-center gap-3">
      <span className="text-body font-medium">{label}</span>
      <MinutesStepper value={minutes} onChange={onMinutes} label={`Minutes for ${label}`} />
      <span className="text-meta text-ink-3">minutes</span>
      {onRemove ? (
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      ) : null}
    </div>
  );
}

function Words({ state, dispatch }: Part) {
  const [draft, setDraft] = useState("");
  const add = () => {
    if (draft.trim() === "") return;
    dispatch({ type: "addVocabulary", term: draft });
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ul aria-label="Words" className="contents">
        {state.vocabulary.map((item) => (
          <li
            key={item.id}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-card pr-1 pl-3 text-body"
          >
            {item.term}
            <button
              type="button"
              aria-label={`Remove ${item.term}`}
              onClick={() => dispatch({ type: "removeVocabulary", id: item.id })}
              className="flex size-6 items-center justify-center rounded-full text-ink-3 outline-none hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <X aria-hidden size={14} strokeWidth={1.5} />
            </button>
          </li>
        ))}
      </ul>
      <Input
        aria-label="Add a word"
        placeholder="Add a word"
        value={draft}
        disabled={state.vocabulary.length >= VOCABULARY_MAX}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
        className="h-8 w-40 rounded-full"
      />
    </div>
  );
}

function Worksheet({ state, dispatch }: Part) {
  const id = useId();
  const { worksheet } = state;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <span className="flex items-center gap-3">
        <Switch
          id={`${id}-enabled`}
          checked={worksheet.enabled}
          onCheckedChange={(enabled) => dispatch({ type: "setWorksheetEnabled", enabled })}
        />
        <Label htmlFor={`${id}-enabled`} className="text-body">
          {worksheet.enabled ? "Write a worksheet" : "No worksheet"}
        </Label>
      </span>
      {worksheet.enabled ? (
        <>
          <fieldset className="flex items-center gap-2">
            <legend className="sr-only">Tiers to write</legend>
            {TIERS.map((tier) => {
              const on = worksheet.tiers.includes(tier);
              return (
                <button
                  key={tier}
                  type="button"
                  aria-pressed={on}
                  onClick={() => dispatch({ type: "toggleTier", tier })}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full border px-3 text-body font-medium outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:transition-colors",
                    on
                      ? "border-brand-tint-line bg-brand-quiet text-brand-text"
                      : "border-border bg-card text-ink-3 hover:bg-accent hover:text-foreground",
                  )}
                >
                  {TIER_LABELS[tier]}
                </button>
              );
            })}
          </fieldset>
          <span className="text-meta text-ink-2 tabular-nums">
            {worksheet.blocks.length} blocks
          </span>
        </>
      ) : null}
    </div>
  );
}
