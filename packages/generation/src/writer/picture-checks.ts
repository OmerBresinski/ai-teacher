/*
 * The writer's picture checks (BAKEOFF base4f, TEACH-110 part e), all on:
 *  - match6 + match6w: a several-thing picture ships only when the judge saw every thing the
 *    slide's own words name (`unmatchedItems`, `namedUnmatched`, `seenOf`);
 *  - orphan6: a fit repair that moved the only words naming a pictured thing drops the picture
 *    (`orphansAfterFit`);
 *  - keepPic: a photo dropped from an ask slide is held and fills the slide only when it ended
 *    with no visual (`asksToSee`, `heldPhotoFills`);
 *  - rerouteLists: a rewrite may not paste the lost picture's subject list (`pastedPictureList`).
 * Copied from lab/bakeoff/ab/{pics6,stage2,base4f-fixes}.ts; stage6's bank rule is not here (the
 * writer's pictures use no bank yet).
 */

const SEEN_STOP = new Set(
  "the a an and or of to in on at for with its it this that these those each one two three four five your you they them their is are was were be what which who how why say tell name find point look picture photo show shows".split(
    " ",
  ),
);
/** Size, texture and state words: they describe a thing, they do not name one. */
const _DESCRIBE = new Set(
  "small large big little tiny huge fluffy soft short long new newly full fully grown growing young older old same different clear visible bright dark light round thin thick".split(
    " ",
  ),
);
/** metrics.py's word forms: lower case, a plural's singular. */
export function forms(w: string): Set<string> {
  const x = w.toLowerCase();
  const f = new Set([x]);
  if (x.endsWith("ies") && x.length > 4) f.add(`${x.slice(0, -3)}y`);
  if (x.endsWith("es") && x.length > 4) f.add(x.slice(0, -2));
  if (x.endsWith("s") && x.length > 3) f.add(x.slice(0, -1));
  // Round 6 metric fix (rootcause/pictures.md C): an adjective's noun ("fluffy" = "fluff").
  if (x.endsWith("y") && x.length > 4) f.add(x.slice(0, -1));
  return f;
}

/**
 * Round 6 metric fix (rootcause/pictures.md C), every arm: what a placed picture is known to show.
 * A stock pick carries the judge's `visible`; a generated or library pick passed the judge against its
 * brief but carries no `visible`, so its request (the must-see items it was judged on) counts as seen.
 * A director-split slot (b4-r1t3) shows its tiles too.
 */
export type SeenPhoto = {
  alt?: string;
  about?: string;
  request?: string;
  provider?: string;
  source?: unknown;
  subjects?: { name: string }[];
  tiles?: SeenPhoto[];
};
export function seenOf(p: SeenPhoto): string[] {
  const src = (p.source ?? {}) as { provider?: string; evidence?: { visible?: unknown[] } };
  const visible = (src.evidence?.visible ?? []).map(String);
  const provider = p.provider ?? src.provider;
  const judgedMade = !visible.length && provider !== "pexels" && provider !== "commons";
  return [
    ...visible,
    p.alt ?? "",
    p.about ?? "",
    ...(p.subjects ?? []).map((x) => x.name),
    ...(judgedMade ? [p.request ?? ""] : []),
    ...(p.tiles ?? []).flatMap(seenOf),
  ];
}
const words = (s: string) =>
  (s.match(/[A-Za-z]+/g) ?? []).filter((w) => w.length > 2 && !SEEN_STOP.has(w.toLowerCase()));
const bag = (parts: string[]) => {
  const b = new Set<string>();
  for (const p of parts) for (const w of words(p)) for (const f of forms(w)) b.add(f);
  return b;
};
const hit = (w: string, b: Set<string>) => [...forms(w)].some((f) => b.has(f));

/** Every must_see thing has one of its words among what the judge saw (visible + alt). */
export function covers(mustSee: readonly string[], visible: readonly string[]): boolean {
  const b = bag([...visible]);
  return mustSee.every((m) => words(m).some((w) => hit(w, b)));
}

const ORPHAN_STOP = new Set([
  "the",
  "and",
  "with",
  "for",
  "its",
  "one",
  "two",
  "small",
  "big",
  "large",
]);
const orphanWords = (s: string) =>
  (s.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !ORPHAN_STOP.has(w));
const stem = (w: string) => w.replace(/(es|s)$/, "");

/** The must_see items whose subject (any of its words) appears in the moved text and nowhere kept. */
export function orphanedMustSee(
  mustSee: readonly string[],
  moved: readonly string[],
  kept: readonly string[],
): string[] {
  const bag = (xs: readonly string[]) => new Set(xs.flatMap(orphanWords).map(stem));
  const m = bag(moved);
  const k = bag(kept);
  return mustSee.filter((item) => {
    const ws = orphanWords(item).map(stem);
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

const FX_STOP = new Set(
  "adult adults young small large little baby full body view with without absent separated separate their each both the and are for you its".split(
    " ",
  ),
);
const content = (t: string) =>
  (t.toLowerCase().match(/[a-zà-ÿœ]{3,}/g) ?? []).filter((w) => !FX_STOP.has(w));

/** match6w: the unmatched must_see items the slide's words actually name. */
export function namedUnmatched(unmatched: readonly string[], slideWords: string): string[] {
  const words = new Set(content(slideWords).map((w) => w.replace(/s$/, "")));
  return unmatched.filter((m) => content(m).some((w) => words.has(w.replace(/s$/, ""))));
}

type Slide = Record<string, unknown>;
const itemsOf = (s: Slide): string[] =>
  ["questions", "points", "items"].flatMap((k) =>
    Array.isArray(s[k])
      ? (s[k] as unknown[]).map((x) =>
          typeof x === "string" ? x : String((x as { text?: unknown })?.text ?? ""),
        )
      : [],
  );

/**
 * rerouteLists: the fault when a rewrite's item gains two or more of the lost picture's subjects that
 * the same item did not name before (a pasted picture list), else undefined.
 */
export function pastedPictureList(before: Slide, after: Slide, shows: string): string | undefined {
  const subjects = new Set(content(shows));
  const was = itemsOf(before);
  const now = itemsOf(after);
  for (let k = 0; k < now.length; k++) {
    const old = new Set(content(was[k] ?? ""));
    const added = [...new Set(content(now[k] ?? ""))].filter((w) => subjects.has(w) && !old.has(w));
    if (added.length >= 2)
      return `item ${k + 1} pastes the lost picture's list (${added.join(", ")}); keep the question, no answer lists`;
  }
  return undefined;
}

/**
 * keepPic (D48 result, interim until the writer chooses activity layouts): a slide that asks pupils to
 * point, look, match, find or name things keeps a photo that landed, rather than code dropping it and
 * leaving the ask with no picture (blind21 y1: base4 won all 8 verdicts on such slides).
 */
export const ASK_SLIDE =
  /\b(point|look|match|find the|find these|which (?:one|animal|picture)|name (?:the|each|both)|say the names|pairs?|belongs? (?:together|with))\b/i;
export const asksToSee = (words: string) => ASK_SLIDE.test(words);

/** keepPic: does a slide already carry a table (a word table is a visual; a held photo never replaces it). */
export function hasTable(slide: unknown): boolean {
  const walk = (v: unknown): boolean =>
    Array.isArray(v)
      ? v.some(walk)
      : !!v &&
        typeof v === "object" &&
        Object.entries(v as Record<string, unknown>).some(
          ([k, x]) =>
            (k === "table" && !!x) || (k === "rows" && Array.isArray(x) && x.length > 0) || walk(x),
        );
  return walk(slide);
}

/**
 * keepPic (D48b): a held photo fills its slide only when the slide ended with no visual: no landed
 * picture or diagram among `statuses` and no table. It never replaces a visual a fallback made.
 */
export const heldPhotoFills = (slide: unknown, statuses: (string | undefined)[]) =>
  !statuses.some((s) => s === "photo" || s === "diagram") && !hasTable(slide);
