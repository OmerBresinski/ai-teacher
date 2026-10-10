// A written slide's role in the lesson (the slide-role contract, step 1: roleStamp). One pure rule
// set replaces the separate "is this slide asking?" tests. The stage logs it (`roleStamp`) and
// reads it to hold answers back on asking slides (`roleAsk`).

type S = Record<string, unknown>;

/** The production default: every written slide's role is logged (TEACH-312 part e). */
export const ROLE_STAMP_DEFAULT = true;
/**
 * roleAsk (the slide-role contract, step 2): the drawer's ask and the library fill hide a
 * drawing's answer when the slide's role asks, not only on the four question templates. On by
 * default since TEACH-312 part e, on the replay evidence recorded there.
 */
export const ROLE_ASK_DEFAULT = true;

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
/**
 * A picture or diagram slide headed as a worked example ("Worked example: supplying a leg") shows
 * the working, whatever "Which way next?" its lines ask on the way (TEACH-247 part q: a library
 * model on such a slide was held to a question and fell back). "Your turn" is the pupils' task.
 */
const WORKED_HEADING = /^\s*(?:worked example|example\s*\d*\s*:)(?![^:]*:\s*your turn)/i;
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
 * A sentence that sets pupils a task without a question mark ("Find how many are in one group.",
 * "Write half or quarter for A, B and C."): it opens, at the start of the line or after a full stop,
 * with an imperative ask verb (LIBRARY-PATH s4.1). Words after a colon or semicolon are not a new
 * sentence ("Steps: write the numerator first." teaches), and question words are left to the
 * question mark ("Which is why plants need light." teaches). A slide that also gives a result on
 * any line ("Find one part: 24 ÷ 4 = 6 m.", "Count one group: half of 12 is 6.") is worked or
 * taught, not a task: on the D52 replay that guard keeps 8 teaching slides from being treated as
 * asks and hiding their content. "Match" is not an ask verb here: on a visual slide it is advice
 * ("Match the French noun, not the person speaking."); a matching task has its own layout (pair).
 */
const ASK_OPENER =
  /(?:^|[.!]\s+)(?:find|work out|name|write|label|calculate|sort|count|predict)\b/i;
/** Number words a result may be given in ("the answer is six"); "one" is left out ("is one of"). */
const NUMBER_WORD =
  "zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred";
/**
 * A line that gives a result: an equals sign, "equals" or "equal to" a number, or "is", "are", "makes" or "gives"
 * before a number or number word ("half of 12 is 6", "makes 6", "the answer is six").
 */
const GIVES_RESULT = new RegExp(
  `=|\\bequals\\b|\\bequal to\\s+(?:\\d|(?:${NUMBER_WORD})\\b)|\\b(?:is|are|makes|gives)\\s+(?:\\d|(?:${NUMBER_WORD})\\b)`,
  "i",
);

/**
 * A picture or diagram slide that gives pupils a task: a questions, instruction, ask or prompt field
 * with words in it, or a question mark in its lead or a point ("Which shaded part is one half?"),
 * or a lead or point sentence that opens with an ask verb ("Find how many are in one group.") on a
 * slide that gives no result.
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
  const words = lines.filter((l): l is string => typeof l === "string");
  if (words.some((l) => l.includes("?"))) return true;
  return !words.some((l) => GIVES_RESULT.test(l)) && words.some((l) => ASK_OPENER.test(l.trim()));
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
  if (VISUAL_TEMPLATES.has(t) && WORKED_HEADING.test(String(s.heading ?? ""))) return "worked";
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

/** The slide asks pupils something: every role but teach and worked (discuss included). */
export const asks = (r: SlideRole) => r !== "teach" && r !== "worked";

/**
 * The slide's drawing keeps its answer back for the reveal: it asks and is not a discussion (the
 * slide-role contract: "discuss asks but hides nothing"). An activity hides its answer, so a label
 * task's diagram does not show the names pupils are to write.
 */
export const hidesAnswer = (r: SlideRole) => asks(r) && r !== "discuss";

/**
 * The slide's drawing keeps its answer back, by the slide's own fields (roleAsk). Its place in the
 * deck only splits a question set into retrieval or check, and both hide, so no deck context is
 * needed.
 */
export const slideHidesAnswer = (s: S): boolean => hidesAnswer(slideRole(s, { index: 0 }));

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
