import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  CreateLessonSchema,
  defaultDurationMin,
  deriveAgeBand,
  findNamePatterns,
  GUARD_MESSAGE,
} from "@tj/domain/documents";
import {
  Button,
  Display,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
  toast,
} from "@tj/ui";
import { lazy, type ReactNode, Suspense, useId, useMemo, useRef, useState } from "react";
import { ActionBar } from "@/components/brief/action-bar";
import { ClassContextFields } from "@/components/brief/class-context-fields";
import { Field, GuardHint } from "@/components/brief/field";
import { QuestionBlock } from "@/components/brief/question-block";
import { ThemeTiles } from "@/components/brief/theme-tiles";
import { useLibraryActions } from "@/components/library/use-library-actions";
import { SourceDropZone } from "@/components/source-drop-zone/SourceDropZone";
import {
  type BriefState,
  briefInputOf,
  type GuardedField,
  hasGuardHits,
  INITIAL_BRIEF,
  OTHER_SUBJECT,
  SUBJECTS,
  seedGeneratingLesson,
  YEAR_GROUPS,
} from "@/lib/brief-form";
import { readLastClass, writeLastClass } from "@/lib/brief-memory";
import {
  CONFIDENCE_QUESTION,
  confidenceOptions,
  OBJECTIVE_QUESTION,
  objectiveOptions,
  SUGGESTED_CONFIDENCE_INDEX,
  shouldAskQuestions,
  suggestedObjectiveIndex,
} from "@/lib/brief-questions";
import { libraryMutations } from "@/lib/library";
import { LIBRARY_THEMES } from "@/lib/library-themes";
import { ApiError } from "@/lib/query";

/**
 * `/lessons/new` — the lesson brief (F01 item 2; TEACH-122, TEACH-177). One screen: topic,
 * subject and year group (pre-filled from the last lesson planned in this browser, and said so),
 * a duration that defaults by key stage, six theme tiles drawn as the title slide, optional
 * class context behind a disclosure, and two clarifying questions asked one at a time with the
 * suggestion marked. `CreateLessonSchema` is the only validator — the same one `POST /lessons`
 * runs — so the identifier guard says the same thing here and on the server (ADR 0024 §1–2, §6,
 * §13). "Plan it" sits in a sticky action bar and, when disabled, says why. It posts the brief,
 * seeds the new lesson into the cache and lands on `/l/$lessonId`, where the generating view
 * follows the job. "Blank lesson" keeps the old dialog for a teacher who wants to start empty; it
 * is the only entry point for a blank lesson until Home's tile grows a menu. The form model lives
 * in `lib/brief-form.ts`.
 *
 * The upload entry (F03: a deck, chapter or scheme of work as the brief) has no tab here any
 * more; when it ships it becomes a quiet line under the topic, not a disabled control.
 */

const NewDocumentDialog = lazy(() =>
  import("@/components/new-document-dialog").then(({ NewDocumentDialog }) => ({
    default: NewDocumentDialog,
  })),
);

const DURATION_HINT = "Between 5 and 180 minutes.";
const DURATION_REASON = "Duration must be between 5 and 180 minutes.";
const SOURCES_BUSY_REASON = "Wait for your files to finish uploading.";
const REMEMBERED_HINT = "From your last lesson";
const QUESTION_COUNT = 2;

function SelectField({
  id,
  label,
  value,
  onValueChange,
  items,
  invalid,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  items: readonly string[];
  invalid?: boolean;
  hint?: ReactNode;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          id={id}
          aria-invalid={invalid}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="w-full data-[placeholder]:!text-foreground"
        >
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

/** The brief with the last lesson's class filled in, and which fields that covered. */
function initialBrief(): { state: BriefState; remembered: ReadonlySet<"subject" | "yearGroup"> } {
  const last = readLastClass();
  if (!last) return { state: INITIAL_BRIEF, remembered: new Set() };
  const remembered = new Set<"subject" | "yearGroup">();
  const state = { ...INITIAL_BRIEF };
  if (last.subject && SUBJECTS.includes(last.subject)) {
    state.subject = last.subject;
    state.subjectOther = last.subject === OTHER_SUBJECT ? last.subjectOther : "";
    remembered.add("subject");
  }
  if (last.yearGroup && YEAR_GROUPS.includes(last.yearGroup)) {
    state.yearGroup = last.yearGroup;
    remembered.add("yearGroup");
  }
  if (LIBRARY_THEMES.some((theme) => theme.id === last.themeId)) state.themeId = last.themeId;
  return { state, remembered };
}

export function LessonBriefPage() {
  const topicId = useId();
  const subjectId = useId();
  const subjectOtherId = useId();
  const yearGroupId = useId();
  const durationId = useId();
  const themeId = useId();
  const reasonId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actions = useLibraryActions();
  const { mutateAsync: createLesson, isPending } = useMutation(
    libraryMutations.createLesson(queryClient),
  );
  const [initial] = useState(initialBrief);
  const [state, setState] = useState<BriefState>(initial.state);
  const [remembered, setRemembered] = useState(initial.remembered);
  const [touched, setTouched] = useState<ReadonlySet<GuardedField>>(() => new Set());
  const [serverFields, setServerFields] = useState<ReadonlySet<string>>(() => new Set());
  const [blank, setBlank] = useState({ open: false, session: 0 });
  // Which clarifying questions are settled (accepted or skipped), and how many are on screen.
  // `revealed` never decreases: reopening the first question keeps the second in view with its
  // answer, since that answer is still in state and still submitted.
  const [settled, setSettled] = useState<ReadonlySet<number>>(() => new Set());
  const [revealed, setRevealed] = useState(1);
  const [revealedByKey, setRevealedByKey] = useState(false);
  const [sourcesBusy, setSourcesBusy] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);

  // An edit clears the API's field marks: they describe the request that was sent, not this one.
  const patch = (change: Partial<BriefState>) => {
    setState((current) => ({ ...current, ...change }));
    setServerFields((current) => (current.size === 0 ? current : new Set()));
    if ("subject" in change || "yearGroup" in change) {
      setRemembered((current) => {
        const next = new Set(current);
        if ("subject" in change) next.delete("subject");
        if ("yearGroup" in change) next.delete("yearGroup");
        return next;
      });
    }
  };
  const touch = (field: GuardedField) =>
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));

  const input = useMemo(() => briefInputOf(state), [state]);
  const parsed = useMemo(() => CreateLessonSchema.safeParse(input), [input]);
  const topic = state.topic.trim();
  const durationDefault = defaultDurationMin(deriveAgeBand(state.yearGroup || undefined));
  const durationInvalid =
    state.duration.trim() !== "" &&
    parsed.error?.issues.some((issue) => issue.path.join(".") === "brief.durationMin");
  const canCreate =
    parsed.success && topic.length > 0 && !hasGuardHits(state) && !isPending && !sourcesBusy;
  const topicHit = touched.has("topic") && findNamePatterns(state.topic).length > 0;
  const invalid = (field: string) => serverFields.has(field) || undefined;
  const askQuestions = shouldAskQuestions(topic);
  const objectiveSuggested = suggestedObjectiveIndex(topic);
  const subjectName = state.subject === OTHER_SUBJECT ? state.subjectOther.trim() : state.subject;
  const tileSubtitle = [state.yearGroup, subjectName].filter(Boolean).join(" · ");

  // Why "Plan it" is disabled, in one line under the bar (TEACH-177 item 4).
  const reason = isPending
    ? null
    : sourcesBusy
      ? SOURCES_BUSY_REASON
      : topic.length === 0
        ? "Type a topic to plan the lesson."
        : hasGuardHits(state)
          ? GUARD_MESSAGE
          : durationInvalid
            ? DURATION_REASON
            : parsed.success
              ? null
              : (parsed.error.issues[0]?.message ?? "Check the form.");

  const settle = (index: number) => {
    const next = new Set(settled).add(index);
    setSettled(next);
    if (next.size >= QUESTION_COUNT) {
      submitRef.current?.focus();
      return;
    }
    if (index + 1 >= revealed) {
      setRevealed(index + 1 + 1);
      setRevealedByKey(true);
    }
  };
  const reopen = (index: number) =>
    setSettled((current) => {
      const next = new Set(current);
      next.delete(index);
      return next;
    });

  async function submit(): Promise<void> {
    if (!canCreate) return;
    try {
      const ids = await createLesson(input);
      writeLastClass({
        subject: state.subject,
        subjectOther: state.subjectOther,
        yearGroup: state.yearGroup,
        themeId: state.themeId,
      });
      seedGeneratingLesson(queryClient, input, ids);
      await navigate({ to: "/l/$lessonId", params: { lessonId: ids.lessonId } });
    } catch (error) {
      // The message is the API's plain sentence (F18-R12); the form keeps every value.
      toast(error instanceof Error ? error.message : "Something went wrong.");
      if (error instanceof ApiError && error.fields) setServerFields(new Set(error.fields));
    }
  }

  const rememberedHint = (id: string) => (
    <p id={`${id}-hint`} className="text-meta text-ink-3">
      {REMEMBERED_HINT}
    </p>
  );

  return (
    <main className="min-h-dvh px-6 py-8 lg:px-12">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <Display as="h1" size="lg">
          New lesson
        </Display>

        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <SourceDropZone
            sources={state.sources}
            onChange={(sources) => patch({ sources })}
            onBusyChange={setSourcesBusy}
            disabled={isPending}
          />

          <Field
            id={topicId}
            label="Topic or objective"
            hint={
              topicHit ? (
                <GuardHint id={`${topicId}-hint`} text={state.topic} />
              ) : (
                <p id={`${topicId}-hint`} className="text-meta text-ink-3">
                  What the class should learn. A sentence is plenty. Two short questions follow.
                </p>
              )
            }
          >
            <Textarea
              id={topicId}
              autoFocus
              required
              rows={3}
              value={state.topic}
              onChange={(event) => patch({ topic: event.target.value })}
              onBlur={() => touch("topic")}
              aria-invalid={topicHit || invalid("brief")}
              aria-describedby={`${topicId}-hint`}
              placeholder="Fractions of amounts"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id={subjectId}
              label="Subject"
              value={state.subject}
              onValueChange={(subject) => patch({ subject })}
              items={SUBJECTS}
              invalid={invalid("subject")}
              hint={remembered.has("subject") ? rememberedHint(subjectId) : undefined}
            />
            {state.subject === OTHER_SUBJECT ? (
              <Field id={subjectOtherId} label="Which subject?">
                <Input
                  id={subjectOtherId}
                  value={state.subjectOther}
                  maxLength={80}
                  onChange={(event) => patch({ subjectOther: event.target.value })}
                />
              </Field>
            ) : null}
            <SelectField
              id={yearGroupId}
              label="Year group"
              value={state.yearGroup}
              onValueChange={(yearGroup) => patch({ yearGroup })}
              items={YEAR_GROUPS}
              invalid={invalid("yearGroup")}
              hint={remembered.has("yearGroup") ? rememberedHint(yearGroupId) : undefined}
            />
            <Field
              id={durationId}
              label="Duration (minutes)"
              hint={
                <p
                  id={`${durationId}-hint`}
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
                id={durationId}
                type="number"
                inputMode="numeric"
                min={5}
                max={180}
                step={5}
                value={state.duration}
                placeholder={String(durationDefault)}
                onChange={(event) => patch({ duration: event.target.value })}
                aria-invalid={durationInvalid || undefined}
                aria-describedby={`${durationId}-hint`}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-foreground" id={themeId}>
              Theme
            </span>
            <ThemeTiles
              labelId={themeId}
              topic={topic}
              subtitle={tileSubtitle}
              value={state.themeId}
              onValueChange={(next) => patch({ themeId: next })}
            />
          </div>

          <ClassContextFields state={state} touched={touched} onChange={patch} onBlur={touch} />

          {askQuestions ? (
            <div className="flex flex-col gap-3" data-testid="clarifying-questions">
              <QuestionBlock
                question={OBJECTIVE_QUESTION}
                options={objectiveOptions(topic)}
                answer={state.objective}
                suggestedIndex={objectiveSuggested}
                done={settled.has(0)}
                onChange={(objective) => patch({ objective })}
                onAccept={() => settle(0)}
                onReopen={() => reopen(0)}
              />
              {revealed > 1 ? (
                <QuestionBlock
                  question={CONFIDENCE_QUESTION}
                  options={confidenceOptions()}
                  answer={state.confidence}
                  suggestedIndex={SUGGESTED_CONFIDENCE_INDEX}
                  done={settled.has(1)}
                  autoFocus={revealedByKey}
                  onChange={(confidence) => patch({ confidence })}
                  onAccept={() => settle(1)}
                  onReopen={() => reopen(1)}
                />
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center gap-2 text-meta text-ink-3">
            <span>Or start without a plan:</span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setBlank((current) => ({ open: true, session: current.session + 1 }))}
            >
              Blank lesson
            </Button>
          </div>

          <ActionBar reason={reason} reasonId={reasonId} bleed="page">
            <Button
              ref={submitRef}
              type="submit"
              variant="primary"
              size="lg"
              disabled={!canCreate}
              aria-describedby={reason ? reasonId : undefined}
            >
              {isPending ? <Spinner /> : null}
              Plan it
            </Button>
          </ActionBar>
        </form>
      </div>

      <Suspense fallback={null}>
        {blank.session > 0 ? (
          <NewDocumentDialog
            key={blank.session}
            open={blank.open}
            onOpenChange={(open) => {
              if (!open) setBlank((current) => ({ ...current, open: false }));
            }}
            onCreate={(values) => actions.createNewDocument("lesson", values)}
          />
        ) : null}
      </Suspense>
    </main>
  );
}
