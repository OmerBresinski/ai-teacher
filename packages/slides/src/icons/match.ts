/*
 * Label -> library id (TEACH-310 part b), ported from the pilot's match.js. Pure and
 * deterministic: an exact library id, else an exact match of the normalised label against each
 * concept's label, id and synonyms, else the same with a trailing plural "s" folded on each word.
 * No fuzzy matching and no substring guessing: a miss is null, and callers report it.
 */
import { ICON_CONCEPTS } from "./concepts";
import { ICON_LIBRARY } from "./library";
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

export interface IconIndex {
  exact: Map<string, string>;
  folded: Map<string, string>;
}

export function buildIndex(list: readonly IconConcept[] = ICON_CONCEPTS): IconIndex {
  const exact = new Map<string, string>();
  const folded = new Map<string, string>();
  for (const c of list) {
    for (const s of [c.label, c.id.replace(/-/g, " "), ...c.synonyms]) {
      const n = normalise(s);
      if (!n) continue;
      if (!exact.has(n)) exact.set(n, c.id);
      if (!folded.has(fold(n))) folded.set(fold(n), c.id);
    }
  }
  return { exact, folded };
}
const INDEX = buildIndex();

/** A concept label or synonym -> its id, or null. */
export function matchIcon(label: string | null | undefined, index = INDEX): string | null {
  const n = normalise(label);
  if (!n) return null;
  return index.exact.get(n) ?? index.folded.get(fold(n)) ?? null;
}

/** An exact library id, then `matchIcon`; null on a miss (never a guess). */
export function resolveIcon(label: string | null | undefined): string | null {
  if (!label) return null;
  const key = String(label).trim();
  if (Object.hasOwn(ICON_LIBRARY, key)) return key;
  return matchIcon(key);
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
export function resolveIcons(labels: readonly string[]): IconResolution {
  const ids = labels.map(resolveIcon);
  const misses = [...new Set(labels.filter((_, i) => ids[i] === null))];
  return { ids, misses, complete: misses.length === 0 };
}

/** Every concept label, sorted for a picker (case-insensitive). */
export const ICON_LABELS: readonly string[] = ICON_CONCEPTS.map((c) => c.label).sort((a, b) =>
  a.localeCompare(b, "en", { sensitivity: "base" }),
);
