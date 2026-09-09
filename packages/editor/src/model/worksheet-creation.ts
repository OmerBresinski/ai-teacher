import { type LessonFacts, pupilObjective, type Worksheet } from "@tj/domain/documents";
import { newWorksheet, numberQuestions } from "./worksheet-factories";
import { type Job, WORKSHEET_RECIPES, type WorksheetRecipe } from "./worksheet-recipes";

/*
 * The worksheet creation flow (TEACH-184; Worksheets and activities, rulings 46 to 55): two steps,
 * Source then Kind. Source is a lesson or Blank. Kind is the nine recipes as live miniatures built
 * from the lesson's facts, the six job chips, one Suggested pill and the tier row. This module is
 * the pure half: the reducer the page drives, the suggestion rule, and the sheet a choice makes.
 * The page (`apps/web/src/routes/worksheet-create.page.tsx`) owns the fetching and the create call.
 */

export type CreateSource = { kind: "lesson"; lessonId: string } | { kind: "blank" };

export type CreateStep = "source" | "kind";

export type CreateState = {
  step: CreateStep;
  /** What Source has chosen; `null` until a card is picked. */
  source: CreateSource | null;
  /** The Source step's search box. */
  query: string;
  /** The job chip that filters Kind; `null` shows all nine. */
  job: Job | null;
  /** The recipe picked on Kind; `null` means "the suggested one". */
  recipeId: string | null;
};

export type CreateAction =
  | { type: "search"; query: string }
  | { type: "choose-lesson"; lessonId: string }
  | { type: "choose-blank" }
  | { type: "continue" }
  | { type: "back" }
  | { type: "job"; job: Job | null }
  | { type: "recipe"; recipeId: string };

/** Fresh state; with a lesson id (the editor's Worksheet action) the flow opens on Kind. */
export function initialCreateState(lessonId?: string): CreateState {
  return {
    step: lessonId ? "kind" : "source",
    source: lessonId ? { kind: "lesson", lessonId } : null,
    query: "",
    job: null,
    recipeId: null,
  };
}

export function createReducer(state: CreateState, action: CreateAction): CreateState {
  switch (action.type) {
    case "search":
      return { ...state, query: action.query };
    case "choose-lesson":
      return { ...state, source: { kind: "lesson", lessonId: action.lessonId } };
    case "choose-blank":
      return { ...state, source: { kind: "blank" } };
    case "continue":
      // Blank creates from Source; only a lesson has a Kind step. Continue with nothing chosen
      // is a no-op: the page keeps its primary disabled and says why.
      if (state.step !== "source" || state.source?.kind !== "lesson") return state;
      return { ...state, step: "kind" };
    case "back":
      if (state.step !== "kind") return state;
      // Back keeps the lesson selected so Continue returns to the same Kind.
      return { ...state, step: "source", job: null, recipeId: null };
    case "job": {
      const job = action.job;
      if (job === state.job) return state;
      // A filter that hides the chosen recipe drops the choice back to the suggestion.
      const keep =
        state.recipeId !== null && visibleRecipes(job).some((r) => r.id === state.recipeId);
      return { ...state, job, recipeId: keep ? state.recipeId : null };
    }
    case "recipe":
      return state.recipeId === action.recipeId ? state : { ...state, recipeId: action.recipeId };
  }
}

/** The recipes a job chip leaves showing, in catalogue order. */
export function visibleRecipes(job: Job | null): WorksheetRecipe[] {
  return job ? WORKSHEET_RECIPES.filter((r) => r.jobs.includes(job)) : WORKSHEET_RECIPES;
}

/**
 * Which recipe gets the one Suggested pill: a pure rule on the facts. Misconceptions present →
 * Misconception check; a worked example present → Worked example and practice; otherwise
 * Knowledge check. No facts at all reads as Knowledge check too.
 */
export function suggestRecipe(facts?: LessonFacts): string {
  if (facts && facts.misconceptions.length > 0) return "misconception-check";
  if (facts && facts.workedExamples.length > 0) return "worked-example";
  return "knowledge-check";
}

/** The recipe Kind has selected: the teacher's pick, or the suggestion when there is none. */
export function selectedRecipe(state: CreateState, facts?: LessonFacts): WorksheetRecipe | null {
  const id = state.recipeId ?? suggestRecipe(facts);
  return visibleRecipes(state.job).find((r) => r.id === id) ?? null;
}

/* ---- tiers ------------------------------------------------------------------- */

export type Tier = "support" | "core" | "challenge";

/** Core is the only tier a recipe frame makes; Support and Challenge arrive with generation. */
export const TIERS: { id: Tier; label: string; available: boolean }[] = [
  { id: "support", label: "Support", available: false },
  { id: "core", label: "Core", available: true },
  { id: "challenge", label: "Challenge", available: false },
];

export const TIER_HINT = "Arrive with generation";

/** Shown over the miniatures when the lesson has no facts of its own. */
export const EXAMPLE_FACTS_HINT = "Built from example facts until this lesson has its own";

/* ---- the sheet -------------------------------------------------------------- */

/** What the flow needs from the chosen lesson. */
export type LessonSource = {
  id: string;
  title: string;
  themeId: string;
  subject?: string;
  yearGroup?: string;
  facts?: LessonFacts;
};

/**
 * The page-1 header a sheet made from this lesson carries: the lesson's title and its first
 * objective in the pupil's form ("I can …", TEACH-198). Only the lesson's own facts name the objective; example facts fill blocks, never
 * the header, so a sheet for a lesson without facts is honest about what it knows.
 */
function headerFor(lesson: LessonSource): Worksheet["header"] {
  const objective = lesson.facts?.objectives[0]?.text;
  return {
    showName: true,
    showDate: true,
    showClass: true,
    title: lesson.title,
    ...(objective ? { subtitle: pupilObjective(objective) } : {}),
  };
}

/** An empty sheet in the lesson's clothes, for the miniatures' header, theme and paper. */
export function previewWorksheet(lesson: LessonSource): Worksheet {
  const sheet = newWorksheet(lesson.title, lesson.themeId);
  sheet.header = headerFor(lesson);
  if (lesson.subject) sheet.subject = lesson.subject;
  if (lesson.yearGroup) sheet.yearGroup = lesson.yearGroup;
  return sheet;
}

/**
 * The worksheet Continue creates: the recipe's frame as the blocks (numbered), the header from
 * the lesson, `lessonId`, year, subject and theme from the lesson. The whole frame is the
 * document's initial state, so there is nothing to undo. `facts` is what the frame is built from,
 * which may be example facts when the lesson has none.
 */
export function worksheetFromRecipe(
  recipe: WorksheetRecipe,
  lesson: LessonSource,
  facts: LessonFacts | undefined,
): Worksheet {
  const sheet = previewWorksheet(lesson);
  sheet.blocks = numberQuestions(recipe.build(facts));
  sheet.lessonId = lesson.id;
  // UX ruling 60: marks are an assessment convention. Unset means off.
  if (recipe.jobs.includes("assess")) sheet.showMarks = true;
  return sheet;
}
