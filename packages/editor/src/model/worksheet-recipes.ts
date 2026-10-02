// Moved to `@tj/slides` (ADR 0030 item 4): the nine worksheet recipes. Re-exported here so every
// `../model/worksheet-recipes` import in the editor keeps resolving.
export {
  defaultPracticeMinutes,
  GENERATED_RECIPES,
  isPlaceholder,
  isRecipeId,
  JOBS,
  type Job,
  LESSON_RECIPE,
  PLACEHOLDER_PREFIX,
  PLACEHOLDER_QUESTION,
  RECIPE_PROMPT_VERSION,
  type RecipeId,
  recipeById,
  resolveRecipe,
  suggestFrameRecipe,
  suggestRecipe,
  WORKSHEET_RECIPES,
  type WorksheetRecipe,
} from "@tj/slides/worksheet";
