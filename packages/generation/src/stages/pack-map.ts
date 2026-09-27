/*
 * Lab only (l6kp2 plan A, E53): each objective's pack section, chosen in code with no model call.
 * The objectives call never sees the pack (E52: shown the sections as a menu, it still took one
 * objective per section), so the join is made afterwards by content-word overlap between the
 * objective and each section's title, outcome and fact text. Words every section shares count for
 * little (inverse section frequency), so "demand" or "Prospero" does not pick a section on its own.
 * The best section at or above `PACK_MATCH_THRESHOLD` wins, otherwise null; two objectives may
 * share a section, and a section no objective matches is unused.
 */

export interface PackSectionText {
  title?: string | undefined;
  outcome: string;
  /** The section's facts as plain text (the reference the teach call would get). */
  text: string;
}

/**
 * The lowest score that maps an objective to a section. Calibrated 28 Sept 2026 on the E51 and
 * E52 no-pack objectives against the six E51 packs (lab/l6-kpack/NOTES.md, E53).
 */
export const PACK_MATCH_THRESHOLD = 0.25;

/** An outcome word counts as this many occurrences in the section, a title word more. */
const OUTCOME_BOOST = 10;
const TITLE_BOOST = 15;
/** Occurrences at which a word counts half its full weight in a section. */
const SATURATION = 2;
/** A word the pack never uses counts against every section as this share of a rare word. */
const UNKNOWN_WEIGHT = 0.5;

const STOPWORDS = new Set(
  (
    "a an the and or but of to in on at for with by from into onto as is are was were be been being it its " +
    "this that these those their them they his her he she him we our you your i my me can could would should " +
    "will may might must do does did not no so than then there here what which who whom whose why how when " +
    "where while about after before over under between through during each every both either all any some " +
    "more most other such only own same too very just also one two three first second use using used uses " +
    "explain explains describe describes analyse analyses evaluate evaluates compare identify outline show " +
    "shows help helps make makes making way ways including include includes give gives find finds know " +
    "understand pupil pupils student students lesson learn affect affects effect effects determine " +
    "determines shape shapes convey conveys present presents reveal reveals influence influences create creates"
  ).split(" "),
);

/** A light suffix stripper: enough to meet "erodes"/"erosion"/"eroding" halfway, no more. */
export function stem(word: string): string {
  let w = word;
  for (const suffix of [
    "ations",
    "ation",
    "ments",
    "ment",
    "ingly",
    "ing",
    "ies",
    "ied",
    "ed",
    "es",
    "s",
    "ly",
  ]) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length) + (suffix === "ies" || suffix === "ied" ? "y" : "");
      break;
    }
  }
  if (w.length > 5 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stem);
}

export function contentWords(text: string): Set<string> {
  return new Set(words(text));
}

export interface PackMatch {
  /** The chosen section's index, or null. */
  section: number | null;
  /** Score per section, in section order, rounded to 3 places (for the log). */
  scores: number[];
}

/**
 * Scores one objective against every section, BM25-like: each content word of the objective adds
 * its inverse section frequency times a saturating count of it in the section (outcome and title
 * words boosted); the sum is divided by the most the words the pack knows could add, so a score is
 * 0..1. Objective words the pack never uses do not dilute the score.
 */
export function matchPackSections(
  objectives: readonly { text: string }[],
  sections: readonly PackSectionText[],
  threshold = PACK_MATCH_THRESHOLD,
  tune: { outcomeBoost?: number; titleBoost?: number; k?: number; unknown?: number } = {},
): PackMatch[] {
  const outcomeBoost = tune.outcomeBoost ?? OUTCOME_BOOST;
  const titleBoost = tune.titleBoost ?? TITLE_BOOST;
  const k = tune.k ?? SATURATION;
  const unknown = tune.unknown ?? UNKNOWN_WEIGHT;
  const counts = sections.map((s) => {
    const c = new Map<string, number>();
    const add = (ws: string[], by: number) => {
      for (const w of ws) c.set(w, (c.get(w) ?? 0) + by);
    };
    add(words(s.text), 1);
    add(words(s.outcome), outcomeBoost);
    add(words(s.title ?? ""), titleBoost);
    return c;
  });
  const n = sections.length;
  const idf = (w: string) => {
    const df = counts.filter((c) => c.has(w)).length;
    return df === 0 ? 0 : Math.log((n + 1) / (df + 0.5));
  };
  return objectives.map((o) => {
    const ws = [...contentWords(o.text)];
    const rare = Math.log((n + 1) / 1.5);
    const known = ws.reduce((sum, w) => sum + (idf(w) > 0 ? idf(w) : unknown * rare), 0);
    const scores = counts.map((c) => {
      if (known <= 0) return 0;
      let sum = 0;
      for (const w of ws) {
        const tf = c.get(w) ?? 0;
        sum += idf(w) * (tf / (tf + k));
      }
      return Math.round((sum / known) * 1000) / 1000;
    });
    let best: number | null = null;
    scores.forEach((s, i) => {
      if (s >= threshold && (best === null || s > (scores[best] ?? 0))) best = i;
    });
    return { section: best, scores };
  });
}
