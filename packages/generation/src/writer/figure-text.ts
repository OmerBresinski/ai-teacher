/**
 * A diagram's words must describe what its spec draws (D52 `figure_contradicts_text`).
 *
 * The writer's structured output caps a diagram's arrays (table rows, fraction shapes), so it can
 * plan "a circle, square and rectangle in halves, then in quarters", have the array closed after
 * four shapes, and keep the alt and shows of the figure it planned. The spec is what is drawn, so
 * the words are checked against it and, on a miss, rewritten from it. No model call.
 *
 * - `fraction-shapes`: the shapes, fractions and shape counts the words name.
 * - `table`: number ranges ("one to twenty") and row counts the words name.
 * - `equal-groups`: the group, per-group and total counts the words name. A spec that cannot be
 *   drawn equally (16 in 10 groups) takes the one group count its words agree on instead.
 */

type J = Record<string, unknown>;

/** On unless a run turns it off (`WriterRun.figureTextFromSpec`): words rewritten from the spec. */
export const FIGURE_TEXT_FROM_SPEC_DEFAULT = true;
/** On unless a run turns it off (`WriterRun.figureSpecRepair`): an undrawable spec corrected. */
export const FIGURE_SPEC_REPAIR_DEFAULT = true;

/** Which of the two behaviours run; each is off unless set. */
export type FigureTextOptions = { fromSpec?: boolean; specRepair?: boolean };

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];
const N = `(\\d+|${NUMBER_WORDS.join("|")})`;
const num = (w: string): number => (/^\d+$/.test(w) ? Number(w) : NUMBER_WORDS.indexOf(w));
const say = (n: number) => NUMBER_WORDS[n] ?? String(n);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const sentences = (t: string) =>
  t
    .toLowerCase()
    .split(/[.;!?](?:\s|$)/)
    .filter((s) => s.trim());
const listOf = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ── fraction-shapes ──

const SHAPES = ["circle", "square", "rectangle", "triangle", "hexagon", "pentagon", "oval"];
const SHAPE_RE = new RegExp(`\\b(${SHAPES.join("|")})s?\\b`, "g");
const FRACTIONS: [RegExp, number][] = [
  [/\bhal(?:f|ves)\b|½|\b1\/2\b/, 2],
  [/\bthirds?\b|⅓|\b1\/3\b/, 3],
  [/\bquarters?\b|¼|\b1\/4\b/, 4],
  [/\beighths?\b|⅛|\b1\/8\b/, 8],
];
const EQUAL_PARTS = new RegExp(`\\b${N}\\s+equal\\s+parts\\b`, "g");
const SHAPE_COUNT = new RegExp(
  `\\b${N}\\s+(?:more\\b|(?:types?\\s+of\\s+)?shapes?\\b|\\w+\\s+shapes?\\b)`,
  "g",
);
const DISTRIBUTIVE = /\b(each|every|same|matching|another|both|all)\b|\bmore\b/;

type Part = { shape: string; parts: number; shaded: number };

function partsOf(spec: J): Part[] {
  const shapes = Array.isArray(spec.shapes) ? (spec.shapes as J[]) : [];
  return shapes.map((s) => ({
    shape: str(s.shape),
    parts: Number(s.parts) || 0,
    shaded: Number(s.shaded) || 0,
  }));
}

function fractionShapesMiss(spec: J, words: string, strict = false): string | undefined {
  const parts = partsOf(spec);
  if (!parts.length) return undefined;
  // A shape shows 1/d when cut into d parts, or when its shaded share is 1/d (two quarters: a half).
  const shows = (p: Part, d: number) => p.parts === d || p.shaded * d === p.parts;
  const has = (shape: string, d: number) => parts.some((p) => p.shape === shape && shows(p, d));
  const countOf = (d: number) => parts.filter((p) => shows(p, d)).length;
  const kinds = [...new Set(parts.map((p) => p.shape))];
  for (const s of sentences(words)) {
    const named = [...new Set([...s.matchAll(SHAPE_RE)].map((m) => m[1] as string))];
    const fr = new Set<number>();
    for (const [re, d] of FRACTIONS) if (re.test(s)) fr.add(d);
    for (const m of s.matchAll(EQUAL_PARTS))
      if (num(m[1] as string) > 1) fr.add(num(m[1] as string));
    const counts = [...s.matchAll(SHAPE_COUNT)]
      .map((m) => num(m[1] as string))
      .filter((n) => n > 0);
    for (const m of named) if (!kinds.includes(m)) return `names a ${m} the figure does not draw`;
    if (!fr.size) continue;
    const spread = strict || DISTRIBUTIVE.test(s);
    // A count spreads over every fraction only when the words say so ("each of three shapes");
    // "halves of three shapes and a quarter of a circle" needs three of one of them.
    const short = (n: number, d: number) => countOf(d) < n;
    for (const n of counts) {
      const miss = [...fr].filter((d) => short(n, d));
      if (spread ? miss.length : miss.length === fr.size)
        return `names ${n} shapes in ${miss[0]} parts; the figure draws ${countOf(miss[0] ?? 0)}`;
    }
    const shapes = named.length ? named : spread && !counts.length ? kinds : [];
    for (const d of fr) {
      if (!countOf(d)) return `names shapes in ${d} parts; the figure draws none`;
      if (spread) for (const m of shapes) if (!has(m, d)) return `no ${m} in ${d} parts is drawn`;
    }
  }
  return undefined;
}

function fractionShapesWords(spec: J): string {
  const groups: { parts: number; shaded: number; shapes: string[] }[] = [];
  for (const p of partsOf(spec)) {
    const last = groups[groups.length - 1];
    if (last && last.parts === p.parts && last.shaded === p.shaded) last.shapes.push(p.shape);
    else groups.push({ parts: p.parts, shaded: p.shaded, shapes: [p.shape] });
  }
  const bits = groups.map(
    (g) =>
      `${listOf(g.shapes.map((s) => `a ${s}`))}${g.shapes.length > 1 ? ", each" : ""} with ${say(
        g.shaded,
      )} of ${say(g.parts)} equal parts shaded`,
  );
  return `${cap(bits.join("; then "))}.`;
}

// ── table ──

// Whole numbers only: "85.0 to 84.4" is not the range 0 to 84.
const RANGE = new RegExp(`(?<![\\d.,])\\b${N}\\s*(?:to|-|–|—|through)\\s*${N}\\b(?![.,]\\d)`, "g");
const ROWS = new RegExp(`\\b${N}\\s+rows\\b`, "g");

function tableRows(spec: J): string[][] {
  const rows = Array.isArray(spec.rows) ? (spec.rows as unknown[]) : [];
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => str(c).trim()) : []));
}
const intCells = (rows: string[][]) =>
  new Set(
    rows
      .flat()
      .filter((c) => /^\d+$/.test(c))
      .map(Number),
  );

function tableMiss(spec: J, words: string): string | undefined {
  const rows = tableRows(spec);
  if (!rows.length) return undefined;
  const ints = intCells(rows);
  const text = words.toLowerCase();
  for (const m of text.matchAll(RANGE)) {
    const a = num(m[1] as string);
    const b = num(m[2] as string);
    if (!(a >= 0 && b > a && b - a <= 100)) continue;
    const inside = [...ints].filter((n) => n >= a && n <= b);
    if (inside.length < 2) continue; // the range is not what the table lists
    for (let k = a; k <= b; k++) if (!ints.has(k)) return `names ${a} to ${b}; ${k} is not in it`;
  }
  for (const m of text.matchAll(ROWS)) {
    const n = num(m[1] as string);
    if (n > 0 && n !== rows.length) return `names ${n} rows; the table has ${rows.length}`;
  }
  return undefined;
}

function ranges(ns: number[]): string[] {
  const out: string[] = [];
  const s = [...ns].sort((a, b) => a - b);
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && (s[j + 1] as number) === (s[j] as number) + 1) j++;
    out.push(j > i ? `${s[i]} to ${s[j]}` : String(s[i]));
    i = j + 1;
  }
  return out;
}

function tableWords(spec: J): string {
  const rows = tableRows(spec);
  const header = Array.isArray(spec.header)
    ? [...new Set((spec.header as unknown[]).map((h) => str(h).trim()).filter(Boolean))]
    : [];
  const ints = [...intCells(rows)];
  const cols = header.length ? ` of ${listOf(header)}` : "";
  const span = ints.length >= 2 ? `, for the numbers ${listOf(ranges(ints))}` : "";
  return `A table${cols} in ${say(rows.length)} rows${span}.`;
}

// ── equal-groups ──

const GROUP_WORDS = "groups?|rings?|collections?|sets?|piles?|bags?|plates?|boxes|box";
const GROUPS = new RegExp(`\\b${N}\\s+(?:equal\\s+)?(?:${GROUP_WORDS})\\b`, "g");
const ONE_GROUP = /\b(?:a single|one|a)\s+(?:collection|group|set|pile)\b/;
const PER_GROUP = new RegExp(`\\b(?:${GROUP_WORDS})\\s+of\\s+${N}\\b`, "g");
const ITEMS = "counters|dots|cubes|beads|objects|items|sweets|marbles|stars|apples|sticks";
/** "six counters each", "three counters in each group". */
const EACH = new RegExp(`(?<!-)\\b${N}\\s+(?:\\w+\\s+)?(?:${ITEMS})\\s+(?:in\\s+)?each\\b`, "g");
// Not the "four" of "twenty-four".
const TOTAL = new RegExp(`(?<!-)\\b${N}\\s+(?:\\w+\\s+)?(?:${ITEMS})\\b`, "g");

type Claims = { groups: Set<number>; per: Set<number>; totals: Set<number> };
function groupClaims(words: string): Claims {
  const t = words.toLowerCase();
  const groups = new Set([...t.matchAll(GROUPS)].map((m) => num(m[1] as string)));
  if (ONE_GROUP.test(t)) groups.add(1);
  groups.delete(0);
  const per = new Set(
    [...t.matchAll(PER_GROUP), ...t.matchAll(EACH)].map((m) => num(m[1] as string)),
  );
  const totals = new Set([...t.matchAll(TOTAL)].map((m) => num(m[1] as string)));
  for (const p of per) totals.delete(p); // "groups of 4 counters"
  return { groups, per, totals };
}

function equalGroupsMiss(spec: J, words: string): string | undefined {
  const total = Number(spec.total);
  const groups = Number(spec.groups);
  if (!(total > 0 && groups > 0)) return undefined;
  const c = groupClaims(words);
  if (c.groups.size && !c.groups.has(groups))
    return `names ${[...c.groups]} groups; spec ${groups}`;
  if (c.per.size && !c.per.has(total / groups)) return `names groups of ${[...c.per]}`;
  if (c.totals.size && !c.totals.has(total)) return `names ${[...c.totals]} in all; spec ${total}`;
  return undefined;
}

/** The counts a question slide keeps from pupils: `unknown` hides the per-group count ("?"). */
type Hidden = { per: boolean; total: boolean };
function hiddenOf(spec: J): Hidden {
  const u = spec.unknown;
  return { per: u === true || u === "each", total: u === "total" };
}

/** The writer's own noun for what is drawn ("sweets"), else a neutral one. */
function itemNoun(spec: J): string {
  for (const t of [str(spec.items), str(spec.alt), str(spec.shows)]) {
    const m = t.toLowerCase().match(new RegExp(`\\b(${ITEMS})\\b`));
    if (m) return m[1] as string;
  }
  return "objects";
}

function equalGroupsWords(spec: J): string {
  const total = Number(spec.total);
  const groups = Number(spec.groups);
  const hide = hiddenOf(spec);
  const noun = itemNoun(spec);
  // A hidden total is never stated, nor a per-group count that would give it away.
  const lead = hide.total ? cap(noun) : `${cap(say(total))} ${noun}`;
  if (groups === 1) return `${lead} in one group${hide.total ? "; how many is not shown" : ""}.`;
  const each = total / groups;
  if (!Number.isInteger(each)) return `${lead} across ${say(groups)} groups.`;
  if (hide.total) return `${lead} in ${say(groups)} equal groups; how many in all is not shown.`;
  if (hide.per) return `${lead} in ${say(groups)} equal groups; how many in each is not shown.`;
  return `${lead} in ${say(groups)} equal groups of ${say(each)}.`;
}

/** True when the words state a count the figure hides. */
function equalGroupsLeaks(spec: J, words: string): boolean {
  const hide = hiddenOf(spec);
  const total = Number(spec.total);
  const groups = Number(spec.groups);
  const c = groupClaims(words);
  if (hide.per && c.per.has(total / groups)) return true;
  if (hide.total && (c.totals.has(total) || c.per.size > 0)) return true;
  return false;
}

/**
 * The shows with only its contradicting counts replaced by the spec's, so its teaching purpose
 * stays; undefined when a count to correct is hidden or the result still misses.
 */
function equalGroupsCorrect(spec: J, shows: string): string | undefined {
  const total = Number(spec.total);
  const groups = Number(spec.groups);
  const each = total / groups;
  if (!Number.isInteger(each)) return undefined;
  const hide = hiddenOf(spec);
  let unsafe = false;
  // Same plurality only, so "two groups" never becomes "one groups".
  const swap = (want: number, hidden: boolean) => (m: string, w: string) => {
    const had = num(w.toLowerCase());
    if (had === want) return m;
    if (hidden || (had === 1) !== (want === 1)) unsafe = true;
    const word = /^\d+$/.test(w) ? String(want) : say(want);
    return m.replace(w, /^[A-Z]/.test(w) ? cap(word) : word);
  };
  const ci = (re: RegExp) => new RegExp(re.source, "gi");
  let out = shows.replace(ci(GROUPS), swap(groups, false));
  out = out.replace(ci(PER_GROUP), swap(each, hide.per || hide.total));
  out = out.replace(ci(EACH), swap(each, hide.per || hide.total));
  // A total that matched as a per-group count ("groups of 4 counters") is already right.
  const per = new Set([...groupClaims(out).per]);
  out = out.replace(ci(TOTAL), (m: string, w: string) =>
    per.has(num(w.toLowerCase())) ? m : swap(total, hide.total)(m, w),
  );
  if (unsafe || equalGroupsMiss(spec, out) || equalGroupsLeaks(spec, out)) return undefined;
  return out;
}

// ── the slide ──

type Kind = {
  /** `strict` reads every list as spread over each fraction, for keeping a part unrewritten. */
  miss: (s: J, w: string, strict?: boolean) => string | undefined;
  words: (s: J) => string;
  /** Words that state a count the figure hides from pupils. */
  leaks?: (s: J, w: string) => boolean;
  /** The text with only its contradicting part corrected, when that can be done safely. */
  correct?: (s: J, w: string) => string | undefined;
};
const KINDS: Record<string, Kind> = {
  "fraction-shapes": { miss: fractionShapesMiss, words: fractionShapesWords },
  table: { miss: tableMiss, words: tableWords },
  "equal-groups": {
    miss: equalGroupsMiss,
    words: equalGroupsWords,
    leaks: equalGroupsLeaks,
    correct: equalGroupsCorrect,
  },
};

// Where a teaching purpose starts inside a clause ("... for expressing ages").
const PURPOSE =
  /(?:,\s*|\s+)(?=(?:so that|so|for|ready for|to help|to show|to compare|to practise|to practice|to model|to check)\s)/i;

/**
 * A shows that contradicts its spec, mended: its own counts corrected when the kind can do that
 * safely, else the clean clauses kept (the teaching purpose) beside the description from the spec.
 */
function mendShows(kind: Kind, spec: J, shows: string, text: string): string {
  const fixed = kind.correct?.(spec, shows);
  if (fixed) return fixed;
  const ok = (t: string) => !kind.miss(spec, t, true) && !kind.leaks?.(spec, t);
  const kept: string[] = [];
  let purpose = "";
  for (const part of shows.split(/(?<=[.;!?])\s+/)) {
    const body = part.replace(/[.;!?]+$/, "").trim();
    if (!body) continue;
    if (ok(body)) kept.push(`${cap(body)}.`);
    else if (!purpose) {
      const at = body.search(PURPOSE);
      const tail = at > 0 ? body.slice(at).replace(/^,?\s*/, "") : "";
      if (tail && ok(tail) && !/\d/.test(tail)) purpose = tail;
    }
  }
  const lead = purpose ? `${text.replace(/\.$/, "")}, ${purpose}.` : text;
  return [lead, ...kept].join(" ");
}

export type FigureTextChange = {
  key: string;
  kind: string;
  action: "groups" | "words";
  why: string;
};

/** One figure: its spec fixed (an undrawable group count) or its words rewritten from it. */
export function figureTextFixOne(
  spec: J,
  opts: FigureTextOptions = { fromSpec: true, specRepair: true },
): { spec: J; action: "groups" | "words"; why: string } | undefined {
  const kind = KINDS[str(spec.kind)];
  if (!kind) return undefined;
  const words = [str(spec.alt), str(spec.shows)].filter(Boolean).join(". ");
  if (opts.specRepair && spec.kind === "equal-groups") {
    const total = Number(spec.total);
    const groups = Number(spec.groups);
    if (total > 0 && groups > 0 && total % groups !== 0) {
      const g = [...groupClaims(words).groups];
      if (g.length === 1 && total % (g[0] as number) === 0)
        return {
          spec: { ...spec, groups: g[0] },
          action: "groups",
          why: `${total} cannot share into ${groups}; the words say ${g[0]}`,
        };
    }
  }
  if (!opts.fromSpec) return undefined;
  const why = kind.miss(spec, words);
  if (!why) return undefined;
  // Only the contradicting part is rewritten: the alt becomes the literal description, and the
  // shows keeps its teaching purpose with only the contradiction corrected.
  const text = kind.words(spec);
  const alt = str(spec.alt);
  const shows = str(spec.shows);
  const out: J = { ...spec };
  // A part is kept only if it passes on the strict reading, so nothing kept is less true than
  // the rewrite it replaces.
  if (!alt || kind.miss(spec, alt, true)) out.alt = text;
  if (shows && kind.miss(spec, shows, true)) out.shows = mendShows(kind, spec, shows, text);
  return { spec: out, action: "words", why };
}

/** Every figure on a slide checked against its own words; unchanged when they all agree. */
export function figureTextFix(
  slide: J,
  opts: FigureTextOptions = { fromSpec: true, specRepair: true },
): { slide: J; changes: FigureTextChange[] } {
  const changes: FigureTextChange[] = [];
  let out = slide;
  for (const [key, v] of Object.entries(slide)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const fix = figureTextFixOne(v as J, opts);
    if (!fix) continue;
    out = { ...out, [key]: fix.spec };
    changes.push({ key, kind: str((v as J).kind), action: fix.action, why: fix.why });
  }
  return { slide: out, changes };
}
