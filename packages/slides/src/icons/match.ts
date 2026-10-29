/*
 * Label -> library id (TEACH-310 part b), ported from the pilot's match.js. Pure and
 * deterministic: an exact library id, else an exact match of the normalised label against each
 * concept's label, id and synonyms, else the same with a trailing plural "s" folded on each word.
 * No fuzzy matching and no substring guessing: a miss is null, and callers report it.
 */
import { ICON_CONCEPTS } from "./catalogue";
import type { IconConcept } from "./types";

/** Lower case, "&" -> "and", drop a "Name: description" tail, punctuation and a leading article. */
export function normalise(s: string | null | undefined): string {
  let t = String(s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ");
  if (t.includes(":")) t = t.split(":")[0] as string;
  t = t
    .replace(/['’‘]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ");
  return t
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

const fold = (t: string) =>
  t
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");

/*
 * Words that name a library concept in one subject and something else in another (TEACH-310 part
 * c, #521 review): "root" is a plant's root in science and a square root in maths; "shield" is a
 * Roman shield in history and a shield volcano in geography. Such a term (and its plural) matches
 * only when the caller names a subject that contains one of the listed words; with no subject, or
 * another subject, it misses and the caller reports it. An exact library id still resolves
 * (`resolveIcon`), since a layout that names the id has already chosen the drawing.
 */
export const SCOPED_TERMS: Readonly<Record<string, readonly string[]>> = {
  root: ["science", "biology", "plant", "plants", "botany", "nature", "horticulture"],
  shield: ["history"],
};

export interface IconIndex {
  exact: Map<string, string>;
  folded: Map<string, string>;
  /** folded scoped term -> its concept id (`SCOPED_TERMS` says which subjects it needs) */
  scoped: Map<string, string>;
}

/** What the caller knows about the slide; `subject` is the lesson's subject, e.g. "Science". */
export interface IconMatchContext {
  subject?: string | null;
}

/**
 * Each normalised label, id and synonym -> its concept id. First wins: when two concepts share a
 * term, the one listed earlier keeps it (concept lists are reviewed for collisions, match.test.ts).
 */
export function buildIndex(list: readonly IconConcept[] = ICON_CONCEPTS): IconIndex {
  const exact = new Map<string, string>();
  const folded = new Map<string, string>();
  const scoped = new Map<string, string>();
  for (const c of list) {
    for (const s of [c.label, c.id.replace(/-/g, " "), ...c.synonyms]) {
      const n = normalise(s);
      if (!n) continue;
      if (Object.hasOwn(SCOPED_TERMS, fold(n))) {
        if (!scoped.has(fold(n))) scoped.set(fold(n), c.id);
        continue;
      }
      if (!exact.has(n)) exact.set(n, c.id);
      if (!folded.has(fold(n))) folded.set(fold(n), c.id);
    }
  }
  return { exact, folded, scoped };
}
const INDEX = buildIndex();
/** Every concept id; each one has a drawing (match.test.ts), so the matcher never loads the drawings. */
const CONCEPT_IDS: ReadonlySet<string> = new Set(ICON_CONCEPTS.map((c) => c.id));

function inScope(term: string, subject: string | null | undefined): boolean {
  const words = new Set(normalise(subject).split(" "));
  return (SCOPED_TERMS[term] ?? []).some((w) => words.has(w));
}

/** A concept label or synonym -> its id, or null. A scoped term needs a matching `subject`. */
export function matchIcon(
  label: string | null | undefined,
  index: IconIndex = INDEX,
  context: IconMatchContext = {},
): string | null {
  const n = normalise(label);
  if (!n) return null;
  const hit = index.exact.get(n) ?? index.folded.get(fold(n));
  if (hit) return hit;
  const scoped = index.scoped.get(fold(n));
  return scoped && inScope(fold(n), context.subject) ? scoped : null;
}

/** An exact library id, then `matchIcon`; null on a miss (never a guess). */
export function resolveIcon(
  label: string | null | undefined,
  context: IconMatchContext = {},
): string | null {
  if (!label) return null;
  const key = String(label).trim();
  if (CONCEPT_IDS.has(key)) return key;
  return matchIcon(key, INDEX, context);
}

/** Words as the matcher reads them (lower case, punctuation dropped, plurals folded), in order. */
function wordsOf(s: string): string[] {
  return fold(
    s
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’‘]/g, "")
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .split(" ")
    .filter(Boolean);
}

/** Each concept id -> the word lists of its label, id and synonyms (`wordsOf`). */
const TERMS: ReadonlyMap<string, readonly string[][]> = new Map(
  ICON_CONCEPTS.map((c) => [
    c.id,
    [c.label, c.id.replace(/-/g, " "), ...c.synonyms]
      .map((t) => wordsOf(t).filter((w, i) => i > 0 || !["the", "a", "an"].includes(w)))
      .filter((t) => t.length > 0),
  ]),
);

/** Endings that keep a word's meaning: "fossil" in "fossilised", never "heart" in "hearth". */
const ENDINGS = new Set(["e", "es", "ed", "ing", "er", "ised", "ized", "isation", "ization"]);

/** A term's word against a text's word: the same, or (4+ letters) it with one of `ENDINGS`. */
const sameWord = (term: string, word: string) =>
  word === term ||
  (term.length >= 4 && word.startsWith(term) && ENDINGS.has(word.slice(term.length)));

/**
 * TEACH-247 part by: whether `words` name the concept the icon label draws: one of the concept's
 * terms (label, id or synonym) appears in them as whole words, in order. A writer's icon is
 * shown only when its item's own words name it, since a wrong drawing is worse than none (Romans
 * replay, 29 Oct: "Fort" and "Milecastle" shipped a volcano, the writer's pick from a list that
 * held nothing for a fort). False for a label that resolves to nothing.
 */
export function iconNamedBy(
  icon: string | null | undefined,
  words: string,
  context: IconMatchContext = {},
): boolean {
  const id = resolveIcon(icon, context);
  if (!id) return false;
  const text = wordsOf(words);
  return (TERMS.get(id) ?? []).some((term) =>
    text.some((_, at) =>
      term.every((w, k) => at + k < text.length && sameWord(w, text[at + k] as string)),
    ),
  );
}

/** Each concept id -> the drawing set it was made for (`IconConcept.lesson`: "volcanoes", "reasons"). */
const SET_OF: ReadonlyMap<string, string> = new Map(ICON_CONCEPTS.map((c) => [c.id, c.lesson]));

/**
 * TEACH-247 part by: whether a writer's icon fits the item it sits on. It does when the item's
 * own words name it (`iconNamedBy`), or when the words around it (the slide and the lesson's
 * topic) name a drawing of the same set: a thermometer on "Our body must stay at 37 °C" in a
 * slide about sweat (the set holds the sweat drop), a flame on "Most of London burns" beside a
 * fire. A volcano on "Fort" in a lesson on Hadrian's Wall fits neither, so it is never drawn.
 */
export function iconFits(
  icon: string | null | undefined,
  own: string,
  around: string,
  context: IconMatchContext = {},
): boolean {
  if (iconNamedBy(icon, own, context)) return true;
  const id = resolveIcon(icon, context);
  const set = id ? SET_OF.get(id) : undefined;
  if (!set) return false;
  return ICON_CONCEPTS.some((c) => c.lesson === set && iconNamedBy(c.id, around, context));
}

export interface IconResolution {
  /** one entry per label, null where it missed */
  ids: (string | null)[];
  /** the labels that missed, each once, in order: report these (ruling: misses are never hidden) */
  misses: string[];
  /** every label resolved; layouts are all-or-none, so false means fall back to numbers */
  complete: boolean;
}

/** Resolves a set of item labels at once and reports the misses. */
export function resolveIcons(
  labels: readonly string[],
  context: IconMatchContext = {},
): IconResolution {
  const ids = labels.map((l) => resolveIcon(l, context));
  const misses = [...new Set(labels.filter((_, i) => ids[i] === null))];
  return { ids, misses, complete: misses.length === 0 };
}

/** Every concept label, sorted for a picker (case-insensitive). */
export const ICON_LABELS: readonly string[] = ICON_CONCEPTS.map((c) => c.label).sort((a, b) =>
  a.localeCompare(b, "en", { sensitivity: "base" }),
);
