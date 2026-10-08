// faults-3-6-8 #6 (8 Oct), the code causes of "the picture shows the wrong thing", one switch each:
//  - orphan6 (a): a fit repair that moves a question item off a pictured slide drops the picture when
//    the picture's must_see names a subject only the moved item named (R4 y1 s12: the lamb answers
//    nothing once "The lamb needs its mum..." went to the notes);
//  - match6 (b): a slot whose writer must_see lists several things ships its picture only when the
//    judge's `visible` covers every one (R3 y1 s3: one Texas Longhorn passed for cow, sheep, hen, dog);
//  - stage6 (c): a request naming an age, life stage or sex never reuses a stock bank row, nor a
//    generated row not made for a stage request (R1 y1 s12: a "partly grown female chicken" reused a
//    stock "young black chicken" row whose caption came from our own old request). director v11 has
//    no `stage` field, so the stage is read from the request's words.
import { covers } from "./stage2";

const STOP = new Set(["the", "and", "with", "for", "its", "one", "two", "small", "big", "large"]);
const words = (s: string) =>
  (s.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
const stem = (w: string) => w.replace(/(es|s)$/, "");

/** The must_see items whose subject (any of its words) appears in the moved text and nowhere kept. */
export function orphanedMustSee(
  mustSee: readonly string[],
  moved: readonly string[],
  kept: readonly string[],
): string[] {
  const bag = (xs: readonly string[]) => new Set(xs.flatMap(words).map(stem));
  const m = bag(moved);
  const k = bag(kept);
  return mustSee.filter((item) => {
    const ws = words(item).map(stem);
    return ws.some((w) => m.has(w)) && !ws.some((w) => k.has(w));
  });
}

/** Every string a slide shows (heading, text, questions, items, instruction...), not its picture. */
export function slideWords(s: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key = "") => {
    if (["picture", "pictures", "figure", "notes", "template", "layout"].includes(key)) return;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v && typeof v === "object")
      for (const [k2, x] of Object.entries(v as Record<string, unknown>)) walk(x, k2);
  };
  walk(s);
  return out;
}

/** orphan6: the must_see items of a fit-repaired slide's picture that only moved text named. */
export function orphansAfterFit(
  slide: Record<string, unknown>,
  moved: readonly string[],
): string[] {
  const pic = slide.picture as { must_see?: unknown } | null | undefined;
  if (!pic || !Array.isArray(pic.must_see) || !moved.some((x) => x.trim())) return [];
  return orphanedMustSee(pic.must_see.map(String), moved, slideWords(slide));
}

/** match6: the writer's must_see items the judge's `visible` (and the pick's caption) do not cover. */
export function unmatchedItems(mustSee: readonly string[], seen: readonly string[]): string[] {
  if (mustSee.length < 2) return [];
  return mustSee.filter((m) => !covers([m], seen));
}

/** stage6: an age, life stage or sex in a picture request (director v11 has no `stage` field). */
export const STAGE_WORDS =
  /\b(young|younger|baby|babies|juvenile|immature|adult|adults|grown|full-grown|newborn|hatchling|chicks?|lambs?|calf|calves|foals?|kittens?|pupp(y|ies)|cubs?|piglets?|ducklings?|goslings?|tadpoles?|froglets?|caterpillars?|larvae?|pupae?|eggs?|male|female|cockerel|elderly|teenage|toddler|infant|seedlings?)\b/i;
export const isStageText = (text: string) => STAGE_WORDS.test(text);
