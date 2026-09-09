/**
 * `@tj/editor/worksheet-editor` — the worksheet editing surface (TEACH-109). A separate entry from
 * `@tj/editor/worksheet` for the same reason `lesson` is separate from `present` (ADR 0022 §8): the
 * print route mounts the static sheet and must never pull Tiptap, the toolbars or the typing session
 * into its chunk. The page that mounts `WorksheetEditor` imports `@tj/editor/styles/worksheet-edit.css`.
 */

export { DEMO_LESSON_FACTS } from "../model/demo-facts";
export { getTheme } from "../model/themes";
export {
  type CreateAction,
  type CreateSource,
  type CreateState,
  type CreateStep,
  createReducer,
  EXAMPLE_FACTS_HINT,
  initialCreateState,
  type LessonSource,
  previewWorksheet,
  selectedRecipe,
  suggestRecipe,
  TIER_HINT,
  TIERS,
  type Tier,
  visibleRecipes,
  worksheetFromRecipe,
} from "../model/worksheet-creation";
export {
  JOBS,
  type Job,
  recipeById,
  WORKSHEET_RECIPES,
  type WorksheetRecipe,
} from "../model/worksheet-recipes";
export {
  MINIATURE_SCALE,
  RecipeCard,
  type RecipeCardProps,
  RecipeMiniature,
} from "./AddBlockDialog";
export { type TypingSession, useTypingSessionState } from "./typing-session";
export {
  type CaretIntent,
  useWorksheetSessionState,
  type WorksheetSession,
} from "./use-worksheet-session";
export { WorksheetEditor, type WorksheetEditorProps } from "./WorksheetEditor";
