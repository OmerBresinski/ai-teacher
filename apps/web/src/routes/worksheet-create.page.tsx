import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  DEFAULT_SHEET_RECIPE_ID,
  DEFAULT_THEME_ID,
  type DocumentSummary,
  type Lesson,
  type LessonFacts,
  liveThemeId,
  type Worksheet,
} from "@tj/domain/documents";
import { starterWorksheet } from "@tj/editor/starter";
import {
  type CreateSource,
  type CreateState,
  createReducer,
  DEMO_LESSON_FACTS,
  EXAMPLE_FACTS_HINT,
  exitTicketBlocks,
  getTheme,
  initialCreateState,
  type LessonSource,
  lessonDigest,
  OFFERED_RECIPES,
  previewWorksheet,
  RecipeCard,
  TIER_HINT,
  TIERS,
  worksheetFromRecipe,
} from "@tj/editor/worksheet-editor";
import { Button, cn, Display, SearchInput, Spinner, selectionCardVariants, toast } from "@tj/ui";
import { FileText } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useMemo, useReducer } from "react";
import { ActionBar } from "@/components/brief/action-bar";
import { LessonThumb } from "@/components/lesson-thumb";
import { RoutePendingPage } from "@/components/route-pending-page";
import { OTHER_SUBJECT } from "@/lib/brief-form";
import { readLastClass } from "@/lib/brief-memory";
import { sizeOf, yearAndSubject } from "@/lib/format";
import {
  isFullDocument,
  kindOf,
  libraryMutations,
  libraryQueries,
  librarySelectors,
} from "@/lib/library";
import { LIBRARY_THEMES } from "@/lib/library-themes";
import { worksheetCreateRoute } from "./worksheet-create.route";
// The miniatures are the real sheet, so the page needs the paper and the recipe card styles.
import "@tj/editor/styles/worksheet-edit.css";

/*
 * `/worksheets/new` — the worksheet creation flow (TEACH-184; rulings 46 to 55). Three doors, one
 * room: Source picks a lesson or Blank; Kind shows the nine recipes as live miniatures built from
 * that lesson's facts, filtered by the six job chips, with one Suggested pill and the tier row.
 * Continue creates the sheet through the create mutation with the frame as its initial state and
 * opens the editor. Blank makes the starter sheet with the class remembered from the last brief.
 * The pure half (reducer, suggestion rule, the sheet a choice makes) lives in
 * `@tj/editor` `model/worksheet-creation.ts`.
 */

/** How many lessons Source shows before a search narrows it. */
const RECENT_COUNT = 12;
const BLANK_TITLE = "Untitled worksheet";

export function WorksheetCreatePage() {
  const { lesson: lessonParam } = useSearch({ from: worksheetCreateRoute.id });
  const [state, dispatch] = useReducer(createReducer, lessonParam, initialCreateState);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { mutateAsync: createWorksheet, isPending } = useMutation(
    libraryMutations.createWorksheet(queryClient),
  );

  const lessonsQuery = useInfiniteQuery({
    ...libraryQueries.documents("lesson", { sort: "edited" }),
    select: librarySelectors.items,
  });
  const lessons = lessonsQuery.data ?? [];

  // The chosen lesson's body, for its facts and theme; nothing is fetched until one is chosen.
  const lessonId = state.source?.kind === "lesson" ? state.source.lessonId : undefined;
  const { data: lessonData } = useQuery({
    ...libraryQueries.document(lessonId ?? "", queryClient),
    enabled: lessonId !== undefined,
  });
  // Memoised on the query data, so the Kind step's preview sheet is built once per lesson.
  const lesson = useMemo<LessonSource | null>(
    () =>
      lessonData && isFullDocument(lessonData) && kindOf(lessonData) === "lesson"
        ? {
            id: lessonData.id,
            title: lessonData.title,
            themeId: lessonData.themeId,
            subject: lessonData.subject,
            yearGroup: lessonData.yearGroup,
            facts: "facts" in lessonData ? lessonData.facts : undefined,
          }
        : null,
    [lessonData],
  );

  // The Exit ticket sheet from the lesson's slides, as the worker builds it (plan v2 T6).
  const exitSheet = useMemo(
    () =>
      lessonData && isFullDocument(lessonData) && kindOf(lessonData) === "lesson"
        ? exitTicketBlocks(lessonDigest(lessonData as Lesson))
        : null,
    [lessonData],
  );

  async function create(body: Worksheet): Promise<void> {
    try {
      const created = await createWorksheet(body);
      await navigate({ to: "/w/$worksheetId", params: { worksheetId: created.id } });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  function createBlank(): void {
    const remembered = readLastClass();
    // Ruling 202: a remembered retired theme (chalk) reads as the one it renders in.
    const wanted = remembered?.themeId ? liveThemeId(remembered.themeId) : undefined;
    const themeId =
      wanted && LIBRARY_THEMES.some((theme) => theme.id === wanted) ? wanted : DEFAULT_THEME_ID;
    const sheet = starterWorksheet(BLANK_TITLE, themeId);
    const subject = rememberedSubject(remembered);
    if (subject) sheet.subject = subject;
    if (remembered?.yearGroup) sheet.yearGroup = remembered.yearGroup;
    void create(sheet);
  }

  /**
   * Continue with the source given, not the one in this render's state: a card's Enter chooses
   * and continues in one press, and the reducer has not re-rendered between the two.
   */
  function continueWith(source: CreateSource): void {
    if (isPending) return;
    if (source.kind === "blank") {
      dispatch({ type: "choose-blank" });
      createBlank();
      return;
    }
    dispatch({ type: "choose-lesson", lessonId: source.lessonId });
    dispatch({ type: "continue" });
  }

  if (state.step === "source") {
    return (
      <SourceStep
        state={state}
        lessons={lessons}
        loading={lessonsQuery.isPending}
        pending={isPending}
        onSearch={(query) => dispatch({ type: "search", query })}
        onChoose={(source) =>
          dispatch(
            source.kind === "blank"
              ? { type: "choose-blank" }
              : { type: "choose-lesson", lessonId: source.lessonId },
          )
        }
        onContinue={continueWith}
      />
    );
  }

  if (!lesson) return <RoutePendingPage />;
  return (
    <KindStep
      state={state}
      lesson={lesson}
      exitSheet={exitSheet}
      pending={isPending}
      onRecipe={(recipeId) => dispatch({ type: "recipe", recipeId })}
      onBack={() => dispatch({ type: "back" })}
      onContinue={(recipeId) => {
        if (isPending) return;
        const recipe = OFFERED_RECIPES.find((r) => r.id === recipeId);
        if (!recipe) return;
        const sheet = worksheetFromRecipe(recipe, lesson, lesson.facts ?? DEMO_LESSON_FACTS);
        if (recipe.id === "exit-ticket") {
          if (!exitSheet?.ok) return;
          sheet.blocks = exitSheet.blocks;
          sheet.includeAnswerKey = true;
        }
        void create(sheet);
      }}
    />
  );
}

/** The subject the brief remembered, with "Other" resolved to what was typed. */
function rememberedSubject(remembered: ReturnType<typeof readLastClass>): string | undefined {
  if (!remembered) return undefined;
  const subject =
    remembered.subject === OTHER_SUBJECT ? remembered.subjectOther : remembered.subject;
  return subject.trim() || undefined;
}

/* ---- Source ------------------------------------------------------------------ */

function SourceStep({
  state,
  lessons,
  loading,
  pending,
  onSearch,
  onChoose,
  onContinue,
}: {
  state: CreateState;
  lessons: DocumentSummary[];
  loading: boolean;
  pending: boolean;
  onSearch: (query: string) => void;
  onChoose: (source: CreateSource) => void;
  /** Takes the source to continue with, so Enter on a card needs no second render. */
  onContinue: (source: CreateSource) => void;
}) {
  const reasonId = useId();
  const query = state.query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      query
        ? lessons.filter((doc) => doc.title.toLowerCase().includes(query))
        : lessons.slice(0, RECENT_COUNT),
    [lessons, query],
  );
  const remembered = readLastClass();
  const rememberedClass = remembered
    ? [remembered.yearGroup, rememberedSubject(remembered)].filter(Boolean).join(" ")
    : "";
  const chosenLesson = state.source?.kind === "lesson" ? state.source.lessonId : null;
  const blankChosen = state.source?.kind === "blank";
  const reason = state.source ? null : "Choose a lesson or Blank.";

  /** Enter on a card chooses it and continues in one press; a click only chooses. */
  const enterContinues = (source: CreateSource) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onContinue(source);
  };

  return (
    <main className="min-h-dvh px-6 py-8 lg:px-12" data-create-step="source">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Display as="h1" size="lg">
            New worksheet
          </Display>
          <p className="text-body text-ink-2">
            Start from a lesson, so the sheet is built from what the class was taught. Or start
            blank.
          </p>
        </div>

        <section aria-labelledby="create-from-lesson" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="create-from-lesson" className="text-lead font-semibold text-foreground">
              From a lesson
            </h2>
            <SearchInput
              label="Search lessons"
              placeholder="Search lessons"
              value={state.query}
              onChange={(event) => onSearch(event.target.value)}
              onClear={() => onSearch("")}
              width={280}
            />
          </div>
          {loading ? (
            <p className="text-meta text-ink-3">Loading lessons</p>
          ) : shown.length === 0 ? (
            <p className="text-meta text-ink-3">
              {query ? "No lesson has that in its title." : "No lessons yet. Start blank."}
            </p>
          ) : (
            <ul
              aria-label="Recent lessons"
              className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3"
            >
              {shown.map((doc) => {
                const selected = doc.id === chosenLesson;
                const meta = [yearAndSubject(doc), sizeOf(doc)].filter(Boolean).join(" · ");
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${doc.title}. ${meta}.`}
                      data-lesson-card={doc.id}
                      data-slot="selection-card"
                      className={cn(selectionCardVariants({ selected }), "flex-col gap-2 p-2")}
                      onClick={() => onChoose({ kind: "lesson", lessonId: doc.id })}
                      onKeyDown={enterContinues({ kind: "lesson", lessonId: doc.id })}
                    >
                      <span className="block overflow-hidden rounded-chip">
                        <LessonThumb lesson={doc} />
                      </span>
                      <span className="block truncate font-semibold text-body text-foreground">
                        {doc.title}
                      </span>
                      <span className="block truncate text-meta text-ink-3">{meta}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="create-blank" className="flex flex-col gap-3">
          <h2 id="create-blank" className="text-lead font-semibold text-foreground">
            Blank
          </h2>
          <button
            type="button"
            aria-pressed={blankChosen}
            data-slot="selection-card"
            data-blank-card
            className={cn(
              selectionCardVariants({ selected: blankChosen }),
              "max-w-md items-start gap-3 p-3",
            )}
            onClick={() => onChoose({ kind: "blank" })}
            onKeyDown={enterContinues({ kind: "blank" })}
          >
            <span className="mt-0.5 shrink-0 text-ink-3">
              <FileText aria-hidden size={20} strokeWidth={1.5} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-semibold text-body text-foreground">Blank</span>
              <span className="text-meta text-ink-3">
                The starter sheet: an instruction line and four questions to replace.
              </span>
              {rememberedClass ? (
                <span className="text-meta text-ink-3">
                  {rememberedClass}, from your last lesson.
                </span>
              ) : null}
            </span>
          </button>
        </section>

        <ActionBar reason={reason} reasonId={reasonId} bleed="page">
          <Button
            variant="primary"
            size="lg"
            disabled={!state.source || pending}
            aria-describedby={reason ? reasonId : undefined}
            onClick={() => state.source && onContinue(state.source)}
          >
            {pending ? <Spinner /> : null}
            Continue
          </Button>
        </ActionBar>
      </div>
    </main>
  );
}

/* ---- Kind -------------------------------------------------------------------- */

function KindStep({
  state,
  lesson,
  exitSheet,
  pending,
  onRecipe,
  onBack,
  onContinue,
}: {
  state: CreateState;
  lesson: LessonSource;
  exitSheet: ReturnType<typeof exitTicketBlocks> | null;
  pending: boolean;
  onRecipe: (recipeId: string) => void;
  onBack: () => void;
  onContinue: (recipeId: string) => void;
}) {
  const reasonId = useId();
  const tierHintId = useId();
  const facts: LessonFacts = lesson.facts ?? DEMO_LESSON_FACTS;
  const usingExample = lesson.facts === undefined;
  const worksheet = useMemo(() => previewWorksheet(lesson), [lesson]);
  const theme = getTheme(lesson.themeId);
  // Plan v2 T6: only the offered launch types, the old seven hidden. Exit ticket is the lesson's
  // own exit-ticket slide, so its card is greyed with the reason when the slides have none.
  const shown = useMemo(
    () =>
      OFFERED_RECIPES.map((recipe) => {
        const fromSlides = recipe.id === "exit-ticket" ? exitSheet : null;
        return {
          recipe,
          blocks: fromSlides?.ok ? fromSlides.blocks : recipe.build(facts),
          greyed: fromSlides && !fromSlides.ok ? fromSlides.reason : null,
        };
      }),
    [facts, exitSheet],
  );
  const suggestedId = DEFAULT_SHEET_RECIPE_ID;
  const chosen = shown.find(({ recipe }) => recipe.id === (state.recipeId ?? suggestedId));
  const selected = chosen && !chosen.greyed ? chosen.recipe : null;
  const reason = selected ? null : (chosen?.greyed ?? "Choose a kind of sheet.");

  // Escape returns to Source, as Back does, from anywhere on the step: after Enter on a Source
  // card the focus is on the body, so the listener sits on the window. The chips and cards are
  // plain buttons and nothing else on the page claims the key.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onBack();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  return (
    <main
      className="min-h-dvh px-6 py-8 lg:px-12"
      data-create-step="kind"
      data-facts={usingExample ? "example" : "lesson"}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Display as="h1" size="lg">
            New worksheet
          </Display>
          <p className="text-body text-ink-2">
            For {lesson.title}. Pick the kind of sheet; every card is the sheet it makes.
          </p>
          {usingExample ? (
            <p className="text-meta text-ink-3" data-example-facts-hint>
              {EXAMPLE_FACTS_HINT}
            </p>
          ) : null}
        </div>

        {/* No job chips while one type is offered (plan v2 T6); they return with T7's types. */}

        <ul aria-label="Kinds" className="ws-recipe-grid">
          {shown.map(({ recipe, blocks, greyed }) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              blocks={blocks}
              worksheet={worksheet}
              theme={theme}
              selected={selected?.id === recipe.id}
              suggested={recipe.id === suggestedId}
              fitMiniature
              onPick={() => onRecipe(recipe.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || greyed) return;
                event.preventDefault();
                onRecipe(recipe.id);
                onContinue(recipe.id);
              }}
            />
          ))}
        </ul>

        {/* Not a control yet: Core is the one tier a frame makes, shown as the current state; the
            other two are buttons that are off until generation, so their hint is reachable. */}
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="mb-2 text-meta font-semibold text-ink-2">Tier</legend>
          {TIERS.map((tier) =>
            tier.available ? (
              <span
                key={tier.id}
                className="ws-job-chip ws-tier-chip"
                data-tier={tier.id}
                data-selected="true"
              >
                {tier.label}
                <span className="sr-only">, selected</span>
              </span>
            ) : (
              <button
                key={tier.id}
                type="button"
                className="ws-job-chip ws-tier-chip"
                disabled
                aria-describedby={tierHintId}
                data-tier={tier.id}
              >
                {tier.label}
              </button>
            ),
          )}
          <span id={tierHintId} className="text-meta text-ink-3">
            Support and Challenge: {TIER_HINT.toLowerCase()}.
          </span>
        </fieldset>

        <ActionBar reason={reason} reasonId={reasonId} bleed="page">
          <Button variant="ghost" size="lg" disabled={pending} onClick={onBack}>
            Back
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={!selected || pending}
            aria-describedby={reason ? reasonId : undefined}
            onClick={() => selected && onContinue(selected.id)}
          >
            {pending ? <Spinner /> : null}
            Continue
          </Button>
        </ActionBar>
      </div>
    </main>
  );
}
