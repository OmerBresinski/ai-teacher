// BAKEOFF round 2: the repair guards, in code (round 1 RESULTS: once repair applied, its "layout"
// fixes broke slides). Pure functions over the slide JSON the main call writes; the harness calls
// `repairable` before asking and `judgeRepair` before accepting, and keeps the original otherwise.
type S = Record<string, unknown>;

/** Slides the repair never touches: the title page and the objectives slide (y10 s1 lost its band). */
const NEVER = new Set(["title", "objectives"]);
export function repairable(slide: S | undefined, index: number): boolean {
  return !!slide && index > 1 && !NEVER.has(String(slide.template));
}

/** Keys that hold no pupil-facing words. */
const META = new Set(["template", "kind", "subject", "style"]);
const isFigure = (v: unknown): v is S =>
  !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as S).shows === "string";

/** Every text slot of a slide with its path (figures' requests excluded). */
export function textSlots(slide: unknown, path = ""): { path: string; text: string }[] {
  if (typeof slide === "string") return [{ path, text: slide }];
  if (Array.isArray(slide)) return slide.flatMap((v, k) => textSlots(v, `${path}[${k}]`));
  if (!slide || typeof slide !== "object") return [];
  if (isFigure(slide)) return [];
  return Object.entries(slide as S).flatMap(([k, v]) =>
    META.has(k) || v == null ? [] : textSlots(v, path ? `${path}.${k}` : k),
  );
}

/** The figures a slide asks for: picture (no kind) or diagram (kind), with what each shows. */
export function figuresOf(
  slide: unknown,
): { type: "picture" | "diagram"; shows: string; kind?: string }[] {
  const out: { type: "picture" | "diagram"; shows: string; kind?: string }[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isFigure(v))
      out.push(
        typeof v.kind === "string"
          ? { type: "diagram", shows: String(v.shows), kind: v.kind }
          : { type: "picture", shows: String(v.shows) },
      );
    else if (v && typeof v === "object") Object.values(v as S).forEach(walk);
  };
  walk(slide);
  return out;
}

const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/\*\*/g, "")
    .match(/[\p{L}\p{N}]{3,}/gu) ?? [];
const overlap = (a: string, b: string) => {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / (A.size + B.size - shared);
};
/** The same figure: same type and (near) the same request. */
export const sameFigure = (
  a: { type: string; shows: string },
  b: { type: string; shows: string },
) =>
  a.type === b.type &&
  (a.shows.trim().toLowerCase() === b.shows.trim().toLowerCase() ||
    overlap(a.shows, b.shows) >= 0.5);

const ENDS = /([.?!:;…]|[.?!]["'”’)\]])\s*$/;
const CONTINUES = /^\s*([a-z]|(and|but|or|so|because|while|which|who)\b)/;

export type Verdict = { ok: true } | { ok: false; why: string[] };
/**
 * Accept a repaired slide only when it keeps what the original had:
 * - it is not turned into a title or objectives slide;
 * - no slot is empty (y10 s10: two unlabelled compare cards);
 * - every picture and diagram the original asked for is still asked for (y11 s7 lost both
 *   compare pictures and asked for a new one; a figure that is only re-worded counts as kept);
 * - no sentence is split across separate cards or columns (y10 s10);
 * - no words are lost: the original's words are in the new slide or in `to_notes` (90 %).
 */
export function judgeRepair(before: S, after: S, toNotes: string[] = []): Verdict {
  const why: string[] = [];
  if (NEVER.has(String(after.template))) why.push(`became a ${after.template} slide`);
  for (const s of textSlots(after)) if (!s.text.trim()) why.push(`empty slot ${s.path}`);
  for (const f of figuresOf(after)) if (!f.shows.trim()) why.push(`empty ${f.type} request`);
  const was = figuresOf(before);
  const now = figuresOf(after);
  // One to one: two pictures merged into one new request lose one of them.
  const free = [...now];
  for (const f of was) {
    const k = free.findIndex((g) => sameFigure(f, g));
    if (k < 0) why.push(`lost the ${f.type} "${f.shows.slice(0, 40)}"`);
    else free.splice(k, 1);
  }
  for (const key of ["columns", "sequence"]) {
    const cols = after[key];
    if (!Array.isArray(cols)) continue;
    const texts = cols.map((c) => {
      const o = (c ?? {}) as S;
      return String(o.text ?? o.caption ?? "");
    });
    for (let k = 0; k + 1 < texts.length; k++)
      if (texts[k]?.trim() && !ENDS.test(texts[k] ?? "") && CONTINUES.test(texts[k + 1] ?? ""))
        why.push(`a sentence is split across ${key}[${k}] and ${key}[${k + 1}]`);
  }
  const kept = new Set([
    ...textSlots(after).flatMap((s) => words(s.text)),
    ...toNotes.flatMap(words),
    ...figuresOf(after).flatMap((f) => words(f.shows)),
  ]);
  const had = [...new Set(textSlots(before).flatMap((s) => words(s.text)))];
  const lost = had.filter((w) => !kept.has(w));
  if (had.length && lost.length / had.length > 0.1)
    why.push(`lost ${lost.length} of ${had.length} words (${lost.slice(0, 5).join(", ")})`);
  return why.length ? { ok: false, why } : { ok: true };
}

/** Diagram kinds that draw a real, photographable thing: a failed one may become a picture. */
export const CONCRETE_KINDS = new Set(["labelled-diagram", "cycle", "layers", "river"]);
export const concrete = (kind: string | undefined, shows: string) =>
  !!kind &&
  CONCRETE_KINDS.has(kind) &&
  !/\b(graph|chart|table|axis|axes|model|particles?|flow|equation|ratio|fraction)\b/i.test(shows);

/** Templates that teach (the text-only count); question and title slides are not counted. */
const NOT_TEACHING = new Set([
  "title",
  "objectives",
  "hinge",
  "question-set",
  "practice",
  "exit-ticket",
  "discussion",
]);
export const teaching = (slide: S | undefined) =>
  !!slide && !NOT_TEACHING.has(String(slide.template));
