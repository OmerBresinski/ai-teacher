// lostPic (base4f, coordinator 9 Oct): a lost picture gets a better fallback than words, all in code.
//   1. A compound picture (several subjects in one slot, D45 y1 "cow, sheep, hen and dog above puppy,
//      chick, calf and lamb") is asked again as separate single pictures, one per subject, through the
//      existing picture path (the first in the slot, the rest as tiles).
//   2. A picture of something the diagram library draws (shaded shapes, fractions, number lines,
//      counters in groups; D45 y2 "Name the shaded part") is drawn as that diagram kind instead.
//   3. Only then the old path: the reroute or stand-alone rewrite, then pointGuard's code strip.
// Shapes are never split into photos: step 2's pattern is checked before step 1 splits.

/** The diagram kind that draws what a lost picture asked for, if the library has one. */
export function libraryKind(shows: string): string | undefined {
  const t = shows.toLowerCase();
  if (/\bnumber line\b/.test(t)) return "number-line";
  if (
    /\b(shaded|unshaded|half|halves|quarters?|thirds?|fractions?|semicircles?)\b/.test(t) ||
    /\b(split|divided|cut)\b/.test(t)
  )
    return "fraction-shapes";
  if (/\bcounters?\b/.test(t) || /\bequal groups\b/.test(t)) return "equal-groups";
  return undefined;
}

// D48 live y1 s6: "with a puppy top left, hen top right, dog bottom left and chick bottom right"
// asked for "hen top right" and lost the puppy (a 5-word part); positions and "with" now go first.
const PLACE =
  /\b(on the (left|right)|in the (middle|centre|center)|at the (top|bottom)|(top|bottom|upper|lower) (left|right)|across the (top|bottom)|(below|above) \\w+ position|above|below|beside|next to it)\b/g;
const JUNK =
  /\b(photographs?|photos?|pictures?|images?|separate|full-body|arranged|rows?|again|connecting|lines|written|names|labels?)\b/;

/** The single subjects of a compound picture request, or [] when it asks for one thing. */
export function compoundSubjects(shows: string): string[] {
  // the list follows a colon ("three separate animals: an adult cow on the left, ...") and ends at
  // the first ";" ("; no connecting lines").
  const colon = shows.indexOf(":");
  // D48 live: the second row can follow a ";" ("... across the top; puppy, calf and lamb across the
  // bottom"), so every segment is read and "no connecting lines" is dropped as junk.
  const body = (colon >= 0 ? shows.slice(colon + 1) : shows).replace(/;/g, ",");
  const parts = body
    .replace(PLACE, ",")
    .split(/,|\band\b/)
    .map((p) =>
      p
        .replace(/^\s*with\s+/i, "")
        .replace(/^\s*adults?\s+/i, "")
        .replace(/^\s*(a|an|the|one|two|three|four)\s+/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((p) => p && p.split(" ").length <= 4 && !JUNK.test(p.toLowerCase()));
  const uniq = [...new Set(parts.map((p) => p.toLowerCase()))];
  return uniq.length >= 2 && uniq.length <= 8 ? uniq : [];
}

/**
 * D48 live (p123-2 y1 s6: 5 of 8 tiles landed and the slide still lost every picture): a split is
 * kept when at least 2 single pictures and at least half of them land; the failed tiles drop out.
 */
export const splitLanded = (landed: number, asked: number) => landed >= 2 && landed * 2 >= asked;

export type LostRoute =
  | { how: "library"; kind: string }
  | { how: "split"; subjects: string[] }
  | { how: "none" };

/** Which code fallback a lost picture tries first (library shapes are never split into photos). */
export function routeLostPicture(shows: string): LostRoute {
  const kind = libraryKind(shows);
  if (kind) return { how: "library", kind };
  const subjects = compoundSubjects(shows);
  if (subjects.length) return { how: "split", subjects };
  return { how: "none" };
}

type Slide = Record<string, unknown>;

/**
 * Whether the slide holds another visual besides its lost picture (a figure, tiles, a table or a
 * second picture field): the code fallbacks never replace one (#423 review).
 */
export function otherVisual(s: Slide, key: string): boolean {
  const set = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v != null && v !== false);
  return ["figure", "diagram", "picture", "tiles", "table"].some((f) => f !== key && set(s[f]));
}

/** The slide with its lost picture asked again as one picture per subject (the rest as tiles). */
export function splitSlide(s: Slide, key: string, subjects: string[]): Slide {
  const pic = (x: string) => ({ shows: x, must_see: [x], subject: "generic" });
  const [first, ...rest] = subjects;
  return { ...s, [key]: pic(first as string), tiles: rest.map(pic) };
}

/** The slide with its lost picture replaced by a library diagram of the same thing. */
export function librarySlide(s: Slide, key: string, kind: string, shows: string): Slide {
  const { [key]: _lost, ...rest } = s;
  const tpl = String(s.template ?? "");
  return {
    ...rest,
    template: /picture/.test(tpl) ? tpl.replace("picture", "visual") : tpl || "visual-text",
    figure: { kind, shows, alt: shows, title: null },
  };
}

/**
 * Try the code fallbacks in order. `attempt` swaps the slide and reports whether every new visual
 * landed (the harness restores the slide when it did not). Returns how the slide ended, or
 * undefined when the old path (reroute, stand-alone, pointGuard strip) must run.
 */
export async function lostPictureFallback(
  s: Slide,
  key: string,
  shows: string,
  attempt: (next: Slide, how: "split" | "library") => Promise<boolean>,
): Promise<"split" | "library" | undefined> {
  if (otherVisual(s, key)) return undefined;
  const r = routeLostPicture(shows);
  if (r.how === "library" && (await attempt(librarySlide(s, key, r.kind, shows), "library")))
    return "library";
  if (r.how === "split" && (await attempt(splitSlide(s, key, r.subjects), "split"))) return "split";
  return undefined;
}

/**
 * TEACH-110 part h: a lone generic picture that asks for three or more subjects in one image
 * ("Three golden retrievers shown left to right…: a small puppy, an older puppy and an adult
 * dog") is split at ask time into one panel per subject, made together as one generated set
 * (`split_set`), so it is never generated whole, refused and split again after editable (lostPic).
 * Each panel keeps the request's head ("Three golden retrievers…") so the panels share a subject.
 * Anything else is returned as it is.
 */
export function splitAtAsk(s: Slide): Slide {
  const p = s.picture as { shows?: unknown; subject?: unknown } | null | undefined;
  if (!p || typeof p.shows !== "string" || p.subject === "named") return s;
  if (otherVisual(s, "picture") || libraryKind(p.shows)) return s;
  // Only a named group of three or four ("Three golden retrievers …: a, b and c"): a grid of six
  // or eight separate photographs is an activity's own layout and stays one picture.
  const colon = p.shows.indexOf(":");
  const head = colon > 0 ? p.shows.slice(0, colon).trim() : "";
  const subjects = compoundSubjects(p.shows);
  if (!head || subjects.length < 3 || subjects.length > 4) return s;
  const panel = (x: string) => ({
    shows: head ? `${x} (${head})` : x,
    must_see: [x],
    subject: "generic",
  });
  const [first, ...rest] = subjects;
  return { ...s, picture: panel(first as string), tiles: rest.map(panel), split_set: true };
}
