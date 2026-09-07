import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  CreateLessonSchema,
  defaultDurationMin,
  deriveAgeBand,
  findNamePatterns,
} from "@tj/domain/documents";
import {
  Button,
  Display,
  Input,
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
import { Upload } from "lucide-react";
import { lazy, Suspense, useId, useMemo, useState } from "react";
import { ClassContextFields } from "@/components/brief/class-context-fields";
import { Field, GuardHint } from "@/components/brief/field";
import { QuestionBlock } from "@/components/brief/question-block";
import { useLibraryActions } from "@/components/library/use-library-actions";
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
import {
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
 * thing here and on the server (ADR 0024 §1–2, §6, §13). Create posts the brief, seeds the new
 * lesson into the cache and lands on `/l/$lessonId`, where the generating view follows the job.
 * The upload entry (F03) is a placeholder tab. "Blank lesson" keeps the old dialog for a teacher
 * who wants to start empty. The form model lives in `lib/brief-form.ts`.
 */

const NewDocumentDialog = lazy(() =>
  import("@/components/new-document-dialog").then(({ NewDocumentDialog }) => ({
    default: NewDocumentDialog,
  })),
);

const DURATION_HINT = "Between 5 and 180 minutes.";
const UPLOAD_ICON = <Upload aria-hidden size={16} strokeWidth={1.5} />;

function SelectField({
  id,
  label,
  value,
  onValueChange,
  items,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  items: readonly string[];
  invalid?: boolean;
}) {
  return (
    <Field id={id} label={label}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          id={id}
          aria-invalid={invalid}
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

export function LessonBriefPage() {
  const topicId = useId();
  const subjectId = useId();
  const subjectOtherId = useId();
  const yearGroupId = useId();
  const durationId = useId();
  const themeId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const actions = useLibraryActions();
  const { mutateAsync: createLesson, isPending } = useMutation(
    libraryMutations.createLesson(queryClient),
  );
  const [state, setState] = useState<BriefState>(INITIAL_BRIEF);
  const [touched, setTouched] = useState<ReadonlySet<GuardedField>>(() => new Set());
  const [serverFields, setServerFields] = useState<ReadonlySet<string>>(() => new Set());
  const [blank, setBlank] = useState({ open: false, session: 0 });

  // An edit clears the API's field marks: they describe the request that was sent, not this one.
  const patch = (change: Partial<BriefState>) => {
    setState((current) => ({ ...current, ...change }));
    setServerFields((current) => (current.size === 0 ? current : new Set()));
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
  const canCreate = parsed.success && topic.length > 0 && !hasGuardHits(state) && !isPending;
  const topicHit = touched.has("topic") && findNamePatterns(state.topic).length > 0;
  const invalid = (field: string) => serverFields.has(field) || undefined;

  async function submit(): Promise<void> {
    if (!canCreate) return;
    try {
      const ids = await createLesson(input);
      seedGeneratingLesson(queryClient, input, ids);
      await navigate({ to: "/l/$lessonId", params: { lessonId: ids.lessonId } });
    } catch (error) {
      // The message is the API's plain sentence (F18-R12); the form keeps every value.
      toast(error instanceof Error ? error.message : "Something went wrong.");
      if (error instanceof ApiError && error.fields) setServerFields(new Set(error.fields));
    }
  }

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
            onClick={() => setBlank((current) => ({ open: true, session: current.session + 1 }))}
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
                id={topicId}
                label="Topic or objective"
                hint={
                  topicHit ? (
                    <GuardHint id={`${topicId}-hint`} text={state.topic} />
                  ) : (
                    <p id={`${topicId}-hint`} className="text-meta text-ink-3">
                      What the class should learn. A sentence is plenty.
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
                <RadioGroup
                  aria-labelledby={themeId}
                  value={state.themeId}
                  onValueChange={(next) => patch({ themeId: next })}
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

              <ClassContextFields state={state} touched={touched} onChange={patch} onBlur={touch} />

              {shouldAskQuestions(topic) ? (
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
        {blank.session > 0 ? (
          <NewDocumentDialog
            key={blank.session}
            open={blank.open}
            kind="lesson"
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
