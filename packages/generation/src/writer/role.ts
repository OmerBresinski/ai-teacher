// A written slide's role in the lesson (the slide-role contract, step 1: roleStamp). One pure rule
// set replaces the separate "is this slide asking?" tests; nothing reads it yet, the stage only
// logs it behind `roleStamp`.

type S = Record<string, unknown>;

/** The production default: no role is stamped until the gate is turned on. */
export const ROLE_STAMP_DEFAULT = false;

export type SlideRole =
  | "teach"
  | "worked"
  | "retrieval"
  | "check"
  | "hinge"
  | "practice"
  | "discuss"
  | "activity"
  | "task";

export const SLIDE_ROLES: readonly SlideRole[] = [
  "teach",
  "worked",
  "retrieval",
  "check",
  "hinge",
  "practice",
  "discuss",
  "activity",
  "task",
];

export type RoleContext = {
  /** The slide's index in the deck (title 0, objectives 1, the writer's first slide 2). */
  index: number;
  /** The index of the deck's first teaching slide (teach or worked); absent: none. */
  firstTeaching?: number;
};

/** The activity layouts: pupils sort, match, order, choose or label. */
const ACTIVITY_TEMPLATES = new Set([
  "pair",
  "group-sort",
  "sequence",
  "choose",
  "odd-one-out",
  "label",
]);
/** A worked example: the steps shown, or an equation worked through. */
const WORKED_TEMPLATES = new Set(["steps", "equation-hero"]);
/** Picture and diagram templates, whose words may set pupils a task (#441 isPictureTask). */
const VISUAL_TEMPLATES = new Set([
  "visual-text",
  "big-visual",
  "picture-text",
  "diagram-text",
  "big-picture",
  "big-diagram",
]);

/**
 * A picture or diagram slide that gives pupils a task: a questions, instruction, ask or prompt field
 * with words in it, or a question mark in its lead or a point ("Which shaded part is one half?").
 * A question used as the heading alone ("Why do polar bears have thick fur?") is not a task.
 */
export function visualTask(s: S): boolean {
  if (!VISUAL_TEMPLATES.has(String(s.template ?? ""))) return false;
  const said = (v: unknown): boolean =>
    typeof v === "string" ? v.trim() !== "" : Array.isArray(v) && v.some(said);
  if (["questions", "instruction", "ask", "prompt"].some((k) => said(s[k]))) return true;
  const pts = Array.isArray(s.points) ? s.points : [];
  const lines = [
    s.lead,
    ...pts.map((p) => (p && typeof p === "object" ? (p as { text?: unknown }).text : p)),
  ];
  return lines.some((l) => typeof l === "string" && l.includes("?"));
}

/** The role a slide has by its own fields, before its place in the deck is known. */
function ownRole(s: S): SlideRole | "question-set" {
  const t = String(s.template ?? "");
  if (t === "hinge") return "hinge";
  if (t === "practice") return "practice";
  // An exit ticket checks (Q2 open: whether its answers show on screen).
  if (t === "exit-ticket") return "check";
  if (t === "question-set") return "question-set";
  if (t === "discussion") return "discuss";
  if (ACTIVITY_TEMPLATES.has(t)) return "activity";
  if (WORKED_TEMPLATES.has(t)) return "worked";
  if (visualTask(s)) return "task";
  return "teach";
}

/**
 * The slide's role, rules in order: hinge; practice; exit ticket -> check; question set ->
 * retrieval before the deck's first teaching slide, else check; discussion -> discuss; an activity
 * layout -> activity; steps or equation-hero -> worked; a picture or diagram slide whose words ask
 * (not its heading alone) -> task; else teach.
 */
export function slideRole(s: S, ctx: RoleContext): SlideRole {
  const r = ownRole(s);
  if (r !== "question-set") return r;
  return ctx.firstTeaching !== undefined && ctx.index > ctx.firstTeaching ? "check" : "retrieval";
}

/** The slide asks pupils something (discuss asks but hides nothing). */
export const asks = (r: SlideRole) => r !== "teach" && r !== "worked";

/** The index of the first teaching slide (teach or worked) at or after `from`. */
export function firstTeaching(slides: (S | undefined)[], from = 2): number | undefined {
  for (let i = from; i < slides.length; i++) {
    const s = slides[i];
    if (!s) continue;
    const r = ownRole(s);
    if (r === "teach" || r === "worked") return i;
  }
  return undefined;
}

/** Every writer slide's role (index 2 on; title and objectives have none), by deck index. */
export function slideRoles(slides: (S | undefined)[], from = 2): Map<number, SlideRole> {
  const first = firstTeaching(slides, from);
  const out = new Map<number, SlideRole>();
  for (let i = from; i < slides.length; i++) {
    const s = slides[i];
    if (s) out.set(i, slideRole(s, { index: i, firstTeaching: first }));
  }
  return out;
}
