import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  type ClassContext,
  type CreateLessonInput,
  CreateLessonSchema,
  defaultDurationMin,
  deriveAgeBand,
  findNamePatterns,
  GUARD_MESSAGE,
  NEED_CATEGORIES,
  type NeedCategory,
  SIZE_BANDS,
  type SizeBand,
} from "@tj/domain/documents";
import {
  Button,
  Display,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@tj/ui";
import { ChevronDown, ChevronRight, Upload } from "lucide-react";
import { lazy, Suspense, useId, useMemo, useState } from "react";
import { useLibraryActions } from "@/components/library/use-library-actions";
import {
  type BriefOption,
  type BriefQuestion,
  CONFIDENCE_QUESTION,
  confidenceOptions,
  OBJECTIVE_QUESTION,
  objectiveOptions,
  shouldAskQuestions,
} from "@/lib/brief-questions";
import { libraryMutations } from "@/lib/library";
import { LIBRARY_THEMES } from "@/lib/library-themes";
import { ApiError } from "@/lib/query";

/**
 * `/lessons/new` — the lesson brief (F01 item 2; TEACH-122). One screen: topic, subject, year
 * group, a duration that defaults by key stage, optional class context behind a disclosure, and
 * at most two clarifying questions with their first option pre-selected. `CreateLessonSchema` is
 * the only validator — the same one `POST /lessons` runs — so the identifier guard says the same
 * thing here and on the server (ADR 0024 §1–2, §6, §13). Create posts the brief and lands on
 * `/l/$lessonId`, where the generating view follows the job. The upload entry (F03) is a
 * placeholder tab. "Blank lesson" keeps the old dialog for a teacher who wants to start empty.
 */

const NewDocumentDialog = lazy(() =>
  import("@/components/new-document-dialog").then(({ NewDocumentDialog }) => ({
    default: NewDocumentDialog,
  })),
);

/** England's labels (TeachDeck `year-groups.ts` plus Reception); the label is what is stored. */
const YEAR_GROUPS = ["Reception", ...Array.from({ length: 13 }, (_, i) => `Year ${i + 1}`)];
const OTHER_SUBJECT = "Other…";
const SUBJECTS = [
  "English",
  "Maths",
  "Science",
  "History",
  "Geography",
  "Art and design",
  "Computing",
  "Design and technology",
  "Languages",
  "Music",
  "PE",
  "PSHE",
  "RE",
  OTHER_SUBJECT,
];
const SIZE_BAND_LABELS: Record<SizeBand, string> = {
  under15: "Under 15",
  "15to24": "15–24",
  "25to30": "25–30",
  over30: "Over 30",
};
const NEED_LABELS: Record<NeedCategory, string> = {
  send: "SEND",
  eal: "EAL",
  higherAttaining: "Higher attaining",
  lowerAttaining: "Lower attaining",
  other: "Other",
};
const DURATION_HINT = "Between 5 and 180 minutes.";
const UPLOAD_ICON = <Upload aria-hidden size={16} strokeWidth={1.5} />;

type Answer = { skipped: boolean; index: number };
const DEFAULT_ANSWER: Answer = { skipped: false, index: 0 };

/** The topic ≥ 3 words shows the questions; a shorter one is still a valid brief. */
type BriefState = {
  topic: string;
  subject: string;
  subjectOther: string;
  yearGroup: string;
  duration: string;
  themeId: string;
  classOpen: boolean;
  sizeBand: SizeBand | "";
  needs: Partial<Record<NeedCategory, string>>;
  priorKnowledge: string;
  notes: string;
  objective: Answer;
  confidence: Answer;
};

const INITIAL: BriefState = {
  topic: "",
  subject: "",
  subjectOther: "",
  yearGroup: "",
  duration: "",
  themeId: LIBRARY_THEMES[0]?.id ?? "chalk",
  classOpen: false,
  sizeBand: "",
  needs: {},
  priorKnowledge: "",
  notes: "",
  objective: DEFAULT_ANSWER,
  confidence: DEFAULT_ANSWER,
};

function trimmedOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The class context the form describes, or `undefined` when every field is untouched. */
function classContextOf(state: BriefState): ClassContext | undefined {
  const needs: Partial<Record<NeedCategory, number>> = {};
  for (const category of NEED_CATEGORIES) {
    const raw = (state.needs[category] ?? "").trim();
    if (raw !== "") needs[category] = Number(raw);
  }
  const context: ClassContext = {};
  if (state.sizeBand) context.sizeBand = state.sizeBand;
  if (Object.keys(needs).length > 0) context.needs = needs;
  const prior = trimmedOrUndefined(state.priorKnowledge);
  if (prior !== undefined) context.priorKnowledge = prior;
  const notes = trimmedOrUndefined(state.notes);
  if (notes !== undefined) context.notes = notes;
  return Object.keys(context).length > 0 ? context : undefined;
}

/** What `POST /lessons` receives, exactly (TEACH-122 acceptance: no `durationMin` unless typed). */
export function briefInputOf(state: BriefState): CreateLessonInput {
  const topic = state.topic.trim();
  const brief: CreateLessonInput["brief"] = { topic };
  if (state.duration.trim() !== "") brief.durationMin = Number(state.duration);
  const classContext = classContextOf(state);
  if (classContext) brief.classContext = classContext;
  if (shouldAskQuestions(topic)) {
    const answers: Record<string, string> = {};
    if (!state.objective.skipped) {
      const option = objectiveOptions(topic)[state.objective.index];
      if (option) answers[OBJECTIVE_QUESTION.id] = option.value;
    }
    if (!state.confidence.skipped) {
      const option = confidenceOptions()[state.confidence.index];
      if (option) answers[CONFIDENCE_QUESTION.id] = option.value;
    }
    if (Object.keys(answers).length > 0) brief.answers = answers;
  }
  const subject =
    state.subject === OTHER_SUBJECT
      ? trimmedOrUndefined(state.subjectOther)
      : state.subject || undefined;
  const input: CreateLessonInput = { brief, themeId: state.themeId };
  if (subject !== undefined) input.subject = subject;
  if (state.yearGroup) input.yearGroup = state.yearGroup;
  return input;
}

/** The field's helper line: the guard message with each offending match marked. */
function GuardHint({ id, text }: { id: string; text: string }) {
  const patterns = findNamePatterns(text);
  if (patterns.length === 0) return null;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const pattern of patterns) {
    if (pattern.index < cursor) continue;
    parts.push(text.slice(cursor, pattern.index));
    parts.push(
      <mark
        key={`${pattern.index}-${pattern.match}`}
        className="rounded-xs bg-destructive/15 px-0.5"
      >
        {pattern.match}
      </mark>,
    );
    cursor = pattern.index + pattern.match.length;
  }
  parts.push(text.slice(cursor));
  return (
    <p id={id} role="alert" className="text-meta text-destructive">
      {GUARD_MESSAGE} <span className="text-ink-2">“{parts}”</span>
    </p>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="!text-foreground">
        {label}
      </Label>
      {children}
      {hint}
    </div>
  );
}

function QuestionBlock({
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

export function LessonBriefPage() {
  const ids = {
    topic: useId(),
    subject: useId(),
    subjectOther: useId(),
    yearGroup: useId(),
    duration: useId(),
    prior: useId(),
    notes: useId(),
    classSection: useId(),
    sizeBand: useId(),
  };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actions = useLibraryActions();
  const { mutateAsync: createLesson, isPending } = useMutation(
    libraryMutations.createLesson(queryClient),
  );
  const [state, setState] = useState<BriefState>(INITIAL);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [serverFields, setServerFields] = useState<Set<string>>(() => new Set());
  const [blankOpen, setBlankOpen] = useState(false);
  const [blankSession, setBlankSession] = useState(0);

  const patch = (change: Partial<BriefState>) => setState((current) => ({ ...current, ...change }));
  const touch = (field: string) =>
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));

  const input = useMemo(() => briefInputOf(state), [state]);
  const parsed = useMemo(() => CreateLessonSchema.safeParse(input), [input]);
  const topic = state.topic.trim();
  const askQuestions = shouldAskQuestions(topic);
  const durationDefault = defaultDurationMin(deriveAgeBand(state.yearGroup || undefined));
  const guardBlocks =
    findNamePatterns(state.topic).length > 0 ||
    findNamePatterns(state.priorKnowledge).length > 0 ||
    findNamePatterns(state.notes).length > 0;
  const durationInvalid =
    state.duration.trim() !== "" &&
    parsed.error?.issues.some((issue) => issue.path.join(".") === "brief.durationMin");
  const canCreate = parsed.success && topic.length > 0 && !guardBlocks && !isPending;

  async function submit(): Promise<void> {
    if (!canCreate) return;
    try {
      const { lessonId } = await createLesson(input);
      await navigate({ to: "/l/$lessonId", params: { lessonId } });
    } catch (error) {
      // The message is the API's plain sentence (F18-R12); the form keeps every value.
      toast(error instanceof Error ? error.message : "Something went wrong.");
      if (error instanceof ApiError && error.fields) setServerFields(new Set(error.fields));
    }
  }

  const invalid = (field: string) => serverFields.has(field) || undefined;
  const showTopicGuard = touched.has("topic") && findNamePatterns(state.topic).length > 0;
  const showPriorGuard = touched.has("prior") && findNamePatterns(state.priorKnowledge).length > 0;
  const showNotesGuard = touched.has("notes") && findNamePatterns(state.notes).length > 0;

  return (
    <main className="min-h-dvh px-6 py-8 lg:px-12">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-baseline justify-between gap-4">
          <Display as="h1" size="lg">
            New lesson
          </Display>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setBlankSession((n) => n + 1);
              setBlankOpen(true);
            }}
          >
            Blank lesson
          </Button>
        </div>

        <Tabs defaultValue="describe">
          <TabsList aria-label="How to start">
            <TabsTrigger value="describe">Describe it</TabsTrigger>
            <TabsTrigger value="upload" disabled title="Coming soon">
              {UPLOAD_ICON}
              Upload — coming soon
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upload" forceMount className="hidden">
            <p className="text-meta text-ink-3">
              Upload a deck, chapter or scheme of work — coming soon.
            </p>
          </TabsContent>
          <TabsContent value="describe">
            <form
              className="mt-4 flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Field
                id={ids.topic}
                label="Topic or objective"
                hint={
                  showTopicGuard ? (
                    <GuardHint id={`${ids.topic}-hint`} text={state.topic} />
                  ) : (
                    <p id={`${ids.topic}-hint`} className="text-meta text-ink-3">
                      What the class should learn. A sentence is plenty.
                    </p>
                  )
                }
              >
                <Textarea
                  id={ids.topic}
                  autoFocus
                  required
                  rows={3}
                  value={state.topic}
                  onChange={(event) => patch({ topic: event.target.value })}
                  onBlur={() => touch("topic")}
                  aria-invalid={showTopicGuard || invalid("brief")}
                  aria-describedby={`${ids.topic}-hint`}
                  placeholder="Fractions of amounts"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={ids.subject} label="Subject">
                  <Select value={state.subject} onValueChange={(subject) => patch({ subject })}>
                    <SelectTrigger
                      id={ids.subject}
                      aria-invalid={invalid("subject")}
                      className="w-full data-[placeholder]:!text-foreground"
                    >
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        {SUBJECTS.map((subject) => (
                          <SelectItem key={subject} value={subject}>
                            {subject}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                {state.subject === OTHER_SUBJECT ? (
                  <Field id={ids.subjectOther} label="Which subject?">
                    <Input
                      id={ids.subjectOther}
                      value={state.subjectOther}
                      maxLength={80}
                      onChange={(event) => patch({ subjectOther: event.target.value })}
                    />
                  </Field>
                ) : null}
                <Field id={ids.yearGroup} label="Year group">
                  <Select
                    value={state.yearGroup}
                    onValueChange={(yearGroup) => patch({ yearGroup })}
                  >
                    <SelectTrigger
                      id={ids.yearGroup}
                      aria-invalid={invalid("yearGroup")}
                      className="w-full data-[placeholder]:!text-foreground"
                    >
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        {YEAR_GROUPS.map((group) => (
                          <SelectItem key={group} value={group}>
                            {group}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  id={ids.duration}
                  label="Duration (minutes)"
                  hint={
                    <p
                      id={`${ids.duration}-hint`}
                      className={
                        durationInvalid ? "text-meta text-destructive" : "text-meta text-ink-3"
                      }
                      role={durationInvalid ? "alert" : undefined}
                    >
                      {durationInvalid
                        ? DURATION_HINT
                        : `Leave empty for ${durationDefault} minutes, the usual length for this year group.`}
                    </p>
                  }
                >
                  <Input
                    id={ids.duration}
                    type="number"
                    inputMode="numeric"
                    min={5}
                    max={180}
                    step={5}
                    value={state.duration}
                    placeholder={String(durationDefault)}
                    onChange={(event) => patch({ duration: event.target.value })}
                    aria-invalid={durationInvalid || undefined}
                    aria-describedby={`${ids.duration}-hint`}
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-body font-medium text-foreground" id={`${ids.topic}-theme`}>
                  Theme
                </span>
                <RadioGroup
                  aria-labelledby={`${ids.topic}-theme`}
                  value={state.themeId}
                  onValueChange={(themeId) => patch({ themeId })}
                  className="flex flex-wrap gap-2"
                >
                  {LIBRARY_THEMES.map((theme) => (
                    <RadioGroupItem
                      key={theme.id}
                      value={theme.id}
                      aria-label={theme.name}
                      title={theme.name}
                      className="size-9 rounded-control border-border-control aspect-square data-[state=checked]:ring-2 data-[state=checked]:ring-ring"
                      style={{ backgroundColor: theme.swatch, color: theme.ink }}
                    />
                  ))}
                </RadioGroup>
                <p className="text-meta text-ink-3">
                  {LIBRARY_THEMES.find((theme) => theme.id === state.themeId)?.name}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  aria-expanded={state.classOpen}
                  aria-controls={ids.classSection}
                  onClick={() => patch({ classOpen: !state.classOpen })}
                >
                  {state.classOpen ? (
                    <ChevronDown aria-hidden size={16} strokeWidth={1.5} />
                  ) : (
                    <ChevronRight aria-hidden size={16} strokeWidth={1.5} />
                  )}
                  {state.classOpen ? "Class context" : "Add class context"}
                </Button>
                {state.classOpen ? (
                  <div
                    id={ids.classSection}
                    className="flex flex-col gap-4 rounded-card border border-border-control/40 bg-card p-4"
                  >
                    <p className="text-meta text-ink-3">
                      About the class as a group — never about a pupil. No names, no rosters.
                    </p>
                    <div className="flex flex-col gap-1.5">
                      <span id={ids.sizeBand} className="text-body font-medium text-foreground">
                        Class size
                      </span>
                      <RadioGroup
                        aria-labelledby={ids.sizeBand}
                        value={state.sizeBand}
                        onValueChange={(value) => patch({ sizeBand: value as SizeBand })}
                        className="flex flex-wrap gap-4"
                      >
                        {SIZE_BANDS.map((band) => (
                          <div key={band} className="flex items-center gap-2">
                            <RadioGroupItem id={`${ids.sizeBand}-${band}`} value={band} />
                            <Label
                              htmlFor={`${ids.sizeBand}-${band}`}
                              className="!text-foreground font-normal"
                            >
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
                            id={`${ids.sizeBand}-need-${category}`}
                            label={NEED_LABELS[category]}
                          >
                            <Input
                              id={`${ids.sizeBand}-need-${category}`}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={99}
                              value={state.needs[category] ?? ""}
                              onChange={(event) =>
                                patch({ needs: { ...state.needs, [category]: event.target.value } })
                              }
                            />
                          </Field>
                        ))}
                      </div>
                    </fieldset>
                    <Field
                      id={ids.prior}
                      label="What the class already knows"
                      hint={
                        showPriorGuard ? (
                          <GuardHint id={`${ids.prior}-hint`} text={state.priorKnowledge} />
                        ) : undefined
                      }
                    >
                      <Textarea
                        id={ids.prior}
                        rows={2}
                        value={state.priorKnowledge}
                        onChange={(event) => patch({ priorKnowledge: event.target.value })}
                        onBlur={() => touch("prior")}
                        aria-invalid={showPriorGuard || undefined}
                        aria-describedby={showPriorGuard ? `${ids.prior}-hint` : undefined}
                        placeholder="Can find a half and a quarter of a shape"
                      />
                    </Field>
                    <Field
                      id={ids.notes}
                      label="Notes"
                      hint={
                        showNotesGuard ? (
                          <GuardHint id={`${ids.notes}-hint`} text={state.notes} />
                        ) : undefined
                      }
                    >
                      <Textarea
                        id={ids.notes}
                        rows={2}
                        value={state.notes}
                        onChange={(event) => patch({ notes: event.target.value })}
                        onBlur={() => touch("notes")}
                        aria-invalid={showNotesGuard || undefined}
                        aria-describedby={showNotesGuard ? `${ids.notes}-hint` : undefined}
                        placeholder="Lively after lunch; several pupils need extra time to write"
                      />
                    </Field>
                  </div>
                ) : null}
              </div>

              {askQuestions ? (
                <div className="flex flex-col gap-3" data-testid="clarifying-questions">
                  <QuestionBlock
                    question={OBJECTIVE_QUESTION}
                    options={objectiveOptions(topic)}
                    answer={state.objective}
                    onChange={(objective) => patch({ objective })}
                  />
                  <QuestionBlock
                    question={CONFIDENCE_QUESTION}
                    options={confidenceOptions()}
                    answer={state.confidence}
                    onChange={(confidence) => patch({ confidence })}
                  />
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2">
                <Button type="submit" disabled={!canCreate}>
                  {isPending ? <Spinner /> : null}
                  Create lesson
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </div>

      <Suspense fallback={null}>
        {blankSession > 0 ? (
          <NewDocumentDialog
            key={blankSession}
            open={blankOpen}
            kind="lesson"
            onOpenChange={(open) => {
              if (!open) setBlankOpen(false);
            }}
            onCreate={(values) => actions.createNewDocument("lesson", values)}
          />
        ) : null}
      </Suspense>
    </main>
  );
}
