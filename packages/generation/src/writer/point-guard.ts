// D47 (D45 fault trace, rootcause/fault-ledger.txt "D45 FULL RUNS" A): a slide whose picture was lost
// kept "Point and say", "Look, choose and say" or "What fraction of A is shaded?" with nothing there.
// The old dangling words ("look at", "can you see") missed every one, so no stand-alone pass ran.
// BAKEOFF base7 and base4f pointGuard, on by default here (TEACH-110 part e):
//  - pointTaskFault flags a pointing task on a slide with no picture or diagram;
//  - stripPointTasks is the code backstop: it removes each pointing sentence and every question about
//    a lettered or left/right shape, and says "Answer from memory." where a task is left. A slide never
//    keeps a pointing instruction with nothing to point at.

/** base4f (49d918df): the heading's "Look at this farm" goes too ("This farm"). */
const LOOK_HEAD = /^\s*(?:look at|point to|find)\s+(?=(?:this|these|the)\b)/i;

/** Words that need pupils to see something on the slide. */
export const POINT_TASK =
  /\b(point(?:s|ing)?\b|look(?:s|ing)?\b(?!\s+after)|can you see|what do you notice|shown (?:here|above|below)|(?:in|on) (?:the|this) (?:picture|photo|image|diagram|drawing)|(?:shape|picture|part)s? [A-D]\b|of [A-D] is\b|[A-D] is shaded|(?:the )?(?:left|right) (?:square|shape|picture|photo|one|side))/i;
/** A question that is about a particular drawn thing: it cannot be kept without the drawing. */
const ABOUT_DRAWN =
  /\b((?:shape|picture|part)s? [A-D]\b|of [A-D] is\b|[A-D] is shaded|(?:the )?(?:left|right) (?:square|shape|picture|photo|one))/i;

export const FROM_MEMORY = "Answer from memory.";

export function pointTaskFault(words: string): string | undefined {
  const m = words.match(POINT_TASK)?.[0];
  return m
    ? `dangling: "${m}" asks pupils to point or look with no picture on the slide`
    : undefined;
}

const sentences = (t: string) => t.match(/[^.?!]+[.?!]*\s*/g) ?? [t];
const keepSentences = (t: string) =>
  sentences(t)
    .filter((p) => !POINT_TASK.test(p))
    .join("")
    .trim();

type S = Record<string, unknown>;
const textOf = (p: unknown) =>
  typeof p === "string"
    ? p
    : p && typeof p === "object"
      ? String((p as { text?: unknown }).text ?? "")
      : "";
const withText = (p: unknown, t: string) =>
  typeof p === "string" ? t : { ...(p as object), text: t };

/** The slide with every pointing task removed (identity when there is none). */
export function stripPointTasks(slide: S): { slide: S; removed: string[] } {
  const out: S = { ...slide };
  const removed: string[] = [];
  for (const k of ["lead", "instruction", "stem", "prompt"]) {
    const v = out[k];
    if (typeof v !== "string") continue;
    const kept = keepSentences(v);
    if (kept !== v.trim()) {
      removed.push(v);
      if (kept) out[k] = kept;
      else delete out[k];
    }
  }
  for (const k of ["points", "questions", "steps"]) {
    if (!Array.isArray(out[k])) continue;
    const next: unknown[] = [];
    for (const p of out[k] as unknown[]) {
      const t = textOf(p);
      if (ABOUT_DRAWN.test(t)) {
        removed.push(t);
        continue;
      }
      const kept = keepSentences(t);
      if (kept !== t.trim()) removed.push(t);
      if (kept) next.push(withText(p, kept));
    }
    out[k] = next;
  }
  if (typeof out.heading === "string" && LOOK_HEAD.test(out.heading)) {
    removed.push(out.heading);
    const h = out.heading.replace(LOOK_HEAD, "");
    out.heading = h.charAt(0).toUpperCase() + h.slice(1);
  }
  if (!removed.length) return { slide, removed };
  const tasks = ["questions", "points", "steps"].some(
    (k) => Array.isArray(out[k]) && (out[k] as unknown[]).length > 0,
  );
  if (
    tasks &&
    typeof out.instruction !== "string" &&
    ["question-set", "practice"].includes(String(out.template))
  )
    out.instruction = FROM_MEMORY;
  return { slide: out, removed };
}

/**
 * A compare whose column pictures were dropped (WRITER-FIX-PLAN fault 3): the slide-level strip,
 * and each column's text loses its pointing sentences ("Look at the pictures.") too.
 */
export function stripComparePointing(slide: S): { slide: S; removed: string[] } {
  const top = stripPointTasks(slide);
  const removed = [...top.removed];
  const cols = Array.isArray(top.slide.columns) ? (top.slide.columns as S[]) : [];
  const columns = cols.map((c) => {
    const t = typeof c?.text === "string" ? c.text : "";
    const kept = keepSentences(t);
    if (kept === t.trim()) return c;
    removed.push(t);
    return { ...c, text: kept };
  });
  if (!removed.length) return { slide, removed };
  return { slide: { ...top.slide, ...(cols.length ? { columns } : {}) }, removed };
}
