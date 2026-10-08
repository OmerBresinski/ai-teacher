/*
 * The edit router's rules (TEACH-97; research harness `route` in
 * `scratchpad/quality-prd/research/edit-agent/edit.ts`, 7 Oct 2026). Code only, no model: an undo
 * intent is handled by the editor, a request that needs more than text on the selection goes to
 * the agent path, everything else to the fast path. Until the slide spec is saved (part c) the
 * agent path is not available, so the API answers an agent request with `AGENT_MESSAGES` and no
 * model call.
 */

/** What an agent request needs: the reason it cannot be a text edit on the selection. */
export type EditNeed = "lesson" | "slides" | "picture" | "animation" | "diagram" | "source";

export type EditRoute = { path: "undo" } | { path: "fast" } | { path: "agent"; need: EditNeed };

const UNDO = /^\s*(undo( that| it)?|go back|put it back|revert( that| it)?|change it back)\b/;
/** The harness's rule, widened to one describing word ("add a practice slide"). */
const STRUCTURE =
  /\b(add|insert|new|remove|delete|merge|split|move|reorder) (a |an |another |one more |two |three )?([a-z-]+ )?(slide|slides)\b|\bmerge\b|\bsplit\b|\brestructure\b/;
const PICTURE = /\b(picture|photo|image|illustration)\b/;
const ANIMATION = /\banimat|\bmove (faster|slower)|\bmoving\b/;
const DIAGRAM =
  /\b(number line|bar model|graph|chart|diagram|table|timeline|venn)\b.*\b(instead|swap|change|switch)|\b(instead|swap|switch) .*\b(diagram|number line|graph|chart)\b/;
const SOURCE = /\b(source|cite|research|look up|latest|statistics?|according to|find out)\b/;

/** `scope` is what the request acts on: the whole lesson, one slide, or a box on a slide. */
export function routeEdit(scope: "lesson" | "slide" | "element", instruction: string): EditRoute {
  const i = instruction.toLowerCase();
  if (UNDO.test(i)) return { path: "undo" };
  if (scope === "lesson") return { path: "agent", need: "lesson" };
  if (STRUCTURE.test(i)) return { path: "agent", need: "slides" };
  if (PICTURE.test(i)) return { path: "agent", need: "picture" };
  if (ANIMATION.test(i)) return { path: "agent", need: "animation" };
  if (DIAGRAM.test(i)) return { path: "agent", need: "diagram" };
  if (SOURCE.test(i)) return { path: "agent", need: "source" };
  return { path: "fast" };
}

/** Teacher-facing answers while the agent path is not available (rulings 171, 176). */
export const AGENT_MESSAGES: Record<EditNeed, string> = {
  lesson: "I can’t change the whole lesson at once yet. I can change one slide at a time.",
  slides: "I can’t add, remove or move slides yet. I can change the text on this slide.",
  picture: "I can’t add or change pictures from here yet. Use Insert to add one.",
  animation: "I can’t animate diagrams yet.",
  diagram: "I can’t swap diagrams yet. I can change the text on this slide.",
  source: "I can’t look things up yet. I can reword what is already on the slide.",
};
