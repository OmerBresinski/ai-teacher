/**
 * lab/cand: a diagram's own title on a slide that already has a heading. It is drawn only when it
 * adds information: a content word the heading, the slide's lines and the drawing's own labels do
 * not already carry. "From chick to hen" under "A chick grows", over a flow ending "Adult hen",
 * says nothing new and is dropped; "Life cycle of a chicken" names the cycle and stays.
 */

const STOP = new Set(
  "a an and are as at be by for from how in into is it its of on or that the their them then this to was what when where which who why with".split(
    " ",
  ),
);

/** A word reduced to a loose stem, so "chicks", "grows", "growing" meet "chick", "grow". */
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "") || w;

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);

/** Every label the drawing itself shows (its strings, less its title, alt and settings). */
function labels(v: unknown, out: string[] = [], key = ""): string[] {
  if (typeof v === "string") {
    if (!["alt", "title", "kind", "layout", "tone", "shape"].includes(key)) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) labels(x, out, key);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) labels(x, out, k);
  return out;
}

/** Whether `spec`'s title says anything the slide (`onSlide`: heading first) and drawing do not. */
export function titleAddsInformation(spec: unknown, onSlide: string[]): boolean {
  const title = (spec as { title?: unknown } | null)?.title;
  if (typeof title !== "string" || !title.trim()) return false;
  const known = new Set([...onSlide, ...labels(spec)].flatMap(words));
  return words(title).some((w) => !known.has(w));
}

/**
 * `spec` without its title when the slide has a heading (`onSlide[0]`) and the title adds nothing
 * to it; otherwise `spec` itself (the same object).
 */
export function withoutEchoTitle(spec: unknown, onSlide: string[]): unknown {
  const s = spec as { title?: unknown } | null;
  if (!s || typeof s !== "object" || typeof s.title !== "string") return spec;
  if (!onSlide[0]?.trim() || titleAddsInformation(spec, onSlide)) return spec;
  const { title: _echo, ...rest } = s;
  return rest;
}
