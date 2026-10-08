// R1 stage 2 (D20 -> round 6, RADICAL.md §R1.3): code owns the text-picture binding after pictures resolve.
// - A picture counts as shown only when the picture judge's `visible` covers every `must_see` (metrics.py's
//   word-form match). A diagram counts as shown when it drew.
// - On a slide whose pictures are not all shown, the items flagged `needs_picture` are dropped.
// - An item that names a thing pictured elsewhere in the lesson but in none of this slide's pictures is dropped
//   too (the y1 "name its adult" with only young tiles case, ROUND5): it can never be answered from the slide.
// - A question-set / practice slide left with no questions is removed; coverage is re-run on the flow and any
//   objective left unchecked goes to the harness's existing objective repair. Title slides are included.
// - restageLayoutOnly: a restage may change the layout and the figure, never the words.
type J = Record<string, unknown>;

const STOP = new Set(
  "the a an and or of to in on at for with its it this that these those each one two three four five your you they them their is are was were be what which who how why say tell name find point look picture photo show shows".split(
    " ",
  ),
);
/** Size, texture and state words: they describe a thing, they do not name one. */
const DESCRIBE = new Set(
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
  (s.match(/[A-Za-z]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
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

export type Item = { text: string; needs_picture: boolean };
const isItem = (x: unknown): x is Item =>
  !!x && typeof x === "object" && "text" in (x as J) && "needs_picture" in (x as J);
/** A slide's pictures in order: tiles, or its one picture / figure. */
export function picturesOf(s: J): J[] {
  if (Array.isArray(s.pictures)) return s.pictures as J[];
  for (const k of ["picture", "figure"]) if (s[k] && typeof s[k] === "object") return [s[k] as J];
  return [];
}
const pictureWords = (p: J) => [
  String(p.shows ?? ""),
  ...((p.must_see as string[]) ?? []),
  ...((p.labels as string[]) ?? []),
];

export type Stage2Result = {
  title: J;
  slides: J[];
  dropped: { slide: number; field: string; text: string; why: string }[];
  removed: number[];
  unchecked: number[];
};

/**
 * Stage 2 on a writer lesson (`title` + `slides`, slide numbers: title 1, slides[i] i + 3).
 * `shown(slide, k)` says whether picture k of that slide shipped and passed `covers` (the caller decides from
 * the judge's verdicts, or an oracle in simulation). `flow` is re-checked for objectives no slide checks any more.
 */
export function applyStage2(
  lesson: { title: J; slides: J[]; flow?: { slide: number; teaches?: number[] }[] },
  shown: (slide: number, k: number) => boolean,
  objectives = 0,
): Stage2Result {
  const dropped: Stage2Result["dropped"] = [];
  const all = [lesson.title, ...lesson.slides];
  const num = (i: number) => (i === 0 ? 1 : i + 2);
  // Things pictured anywhere in the lesson (for "names a thing pictured elsewhere, not here").
  // The lesson's photo vocabulary: what photo pictures were asked to show (must_see), minus size and texture
  // words, so "adult" or "calf" counts and "small" or "fluffy" does not. Diagrams are left out (their words
  // are data, not things).
  const lessonBag = bag(
    all.flatMap((s) =>
      picturesOf(s)
        .filter((p) => !("kind" in p))
        .flatMap((p) =>
          ((p.must_see as string[]) ?? []).flatMap((m) =>
            words(m).filter((w) => !DESCRIBE.has(w.toLowerCase())),
          ),
        ),
    ),
  );
  const out = all.map((s, i) => {
    const pics = picturesOf(s);
    const allShown = pics.length > 0 && pics.every((_, k) => shown(num(i), k));
    // Everything this slide's pictures carry: request, must_see, labels and a diagram spec's words.
    const here = bag(pics.flatMap((p) => [...pictureWords(p), JSON.stringify(p)]));
    const hasDiagram = pics.some((p) => "kind" in p);
    const keep = (field: string, it: unknown): boolean => {
      if (!isItem(it) || !it.needs_picture) return true;
      if (!allShown) {
        dropped.push({
          slide: num(i),
          field,
          text: it.text,
          why: pics.length ? "picture not shown" : "no picture",
        });
        return false;
      }
      const missing = hasDiagram
        ? []
        : words(it.text).filter((w) => hit(w, lessonBag) && !hit(w, here));
      if (missing.length) {
        dropped.push({
          slide: num(i),
          field,
          text: it.text,
          why: `names ${missing.join(", ")}, not in this slide's pictures`,
        });
        return false;
      }
      return true;
    };
    const next: J = { ...s };
    if (Array.isArray(s.questions))
      next.questions = (s.questions as unknown[]).filter((q) => keep("question", q));
    if (s.instruction != null && !keep("instruction", s.instruction)) next.instruction = null;
    if (s.lead != null && !keep("lead", s.lead))
      next.lead = i === 0 ? { text: "", needs_picture: false } : null;
    return next;
  });
  const removed: number[] = [];
  for (const [i, s] of out.entries())
    if (
      i > 0 &&
      ((["question-set", "practice"].includes(String(s.template)) &&
        !(s.questions as unknown[])?.length) ||
        // A discussion slide is its one question: with it dropped, nothing is left to ship.
        (s.template === "discussion" && !s.lead))
    )
      removed.push(num(i));
  const checkedBefore = new Set((lesson.flow ?? []).flatMap((f) => f.teaches ?? []));
  const checkedAfter = new Set(
    (lesson.flow ?? []).filter((f) => !removed.includes(f.slide)).flatMap((f) => f.teaches ?? []),
  );
  const unchecked = Array.from({ length: objectives }, (_, k) => k + 1).filter(
    (o) => checkedBefore.has(o) && !checkedAfter.has(o),
  );
  return { title: out[0] as J, slides: out.slice(1), dropped, removed, unchecked };
}

const TEXT_KEYS = [
  "heading",
  "lead",
  "points",
  "questions",
  "instruction",
  "stem",
  "options",
  "correct",
  "formula",
  "columns",
  "sequence",
];
/** Restage, layout only: the restaged slide keeps the original's words; only the layout and figure may change. */
export function restageLayoutOnly(before: J, after: J): J {
  const out: J = { ...after };
  for (const k of TEXT_KEYS) if (k in before) out[k] = before[k];
  // A layout that cannot hold the original's questions keeps the original layout.
  if (
    "questions" in before &&
    !["question-set", "practice", "exit-ticket"].includes(String(after.template))
  )
    out.template = before.template;
  return out;
}
