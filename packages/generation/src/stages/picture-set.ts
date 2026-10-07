/**
 * Same-subject picture sets (round 3; Greg: the y1 "Growing up" sequence showed a chihuahua puppy,
 * a mongrel and a poodle). Panels that show one subject at different stages (a picture sequence,
 * or compare cards of the same thing) are one set: generated as ONE image of N side-by-side
 * panels in code's frame, cut apart by `splitPanels` (@tj/images), each panel judged against its
 * own request, then the set judged for sameness. Stock is not used for a set: no single stock
 * source returns the same individual at every stage.
 *
 * The frame lines below are code's until the prompt agent owns them (round2/PICTURES3.md).
 */
import type { ImageSize } from "@tj/images";
import {
  housePhoto,
  housePhotoPrompt,
  type LessonLook,
  lessonIllustrationPrompt,
} from "./picture-director";

/** Words that say which stage, size or age a panel is at, not what the subject is. */
const STAGE =
  /^(?:a|an|the|of|same|very|one|its|their|this|that|with|and|in|on|at|from|to|as|her|his|beside|next|alongside|plus|holding|together|both|young|younger|old|older|adult|grown|grown-up|full-grown|full|fully|half|partly|completely|newly|new|fresh|small|smaller|little|tiny|big|bigger|large|larger|tall|taller|short|shorter|growing|developing|developed|early|later|late|final|first|second|third|stage|before|after|start|end|scale|photographic|kind|type|picture|photo|image|view|showing|side-on|standing|sitting|lying|clear|cloudy|melting|melted|rusting|rusty|rusted|burning|burnt|burned|wilting|wilted|ripe|unripe|dry|wet|empty|some|more|less|much|still|now|then)$/i;

/** The words that name what a panel shows, without its stage words. */
export function subjectWords(shows: string): string[] {
  return shows
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STAGE.test(w))
    .map((w) => w.replace(/(?:ies)$/, "y").replace(/(?<=[^s])s$/, ""));
}

/**
 * A set about change across real time (dated, "in the past", a century): not a generated set.
 * Ruling 163: a real place or thing then and now is Commons or nothing, never a made "then".
 */
export function isHistoricalSet(shows: string[]): boolean {
  return shows.some((s) =>
    /\b(?:1[0-9]{3}|20[0-9]{2})s?\b|\bcentur(?:y|ies)\b|\bdecades?\b|\bin the past\b|\bvictorian\b|\bmedieval\b|\btudor\b|\bhistoric(?:al)?\b|\bancient\b|\bthen and now\b|\byears? (?:ago|later)\b/i.test(
      s,
    ),
  );
}

/**
 * True when the panels show one subject at different stages: a panel says "the same", or every
 * panel names a word in common once stage words are dropped ("flask" in each of a three-flask
 * sequence). A sequence of different things (a baby, a child, an adult) is not a set unless it
 * says so; a chick-to-hen sequence names different words, so the arm marks sequences (`always`).
 */
export function isSameSubjectSet(shows: string[], always = false): boolean {
  if (shows.length < 2) return false;
  if (always) return true;
  if (shows.slice(1).some((s) => /\bsame\b/i.test(s))) return true;
  const sets = shows.map((s) => new Set(subjectWords(s)));
  const [first, ...rest] = sets;
  return [...(first ?? [])].some((w) => rest.every((r) => r.has(w)));
}

/** One strip for the set: wide enough that each panel holds a whole subject. */
export function setSize(n: number): ImageSize {
  if (n === 1) return "1024x1024";
  return n >= 3 ? "2048x1152" : "1536x1024";
}

/**
 * The one image a set is generated as. Code's frame (prompt agent to own): N equal panels left to
 * right with white gutters, the panels' own requests in order, the same individual subject at the
 * same scale and view on one plain background, no text. An illustration lesson's locked look
 * leads it, as on every other generation.
 */
export function setImagePrompt(shows: string[], look?: LessonLook, same = true): string {
  const n = shows.length;
  // One panel generated on its own (a partial set's missing stage): a single picture in the
  // strip's look, never a "1-panel strip" (round 5: that wording drew gutters and seams).
  if (n === 1) {
    const one = [
      `${(shows[0] ?? "").replace(/\s+/g, " ").trim().replace(/\.$/, "")}.`,
      "One single photograph, not divided into panels: the subject whole, seen side-on, on a plain light background.",
      "No text anywhere in the image: no words, letters, labels, signs, captions or numbers.",
    ].join("\n");
    if (look?.style === "illustration") return lessonIllustrationPrompt(one, look);
    return housePhoto(look) ? housePhotoPrompt(one, look) : one;
  }
  const body = [
    `One image divided into ${n} equal side-by-side panels separated by thin pure white gaps. Left to right: ${shows
      .map((s, i) => `(${i + 1}) ${s.replace(/\s+/g, " ").trim().replace(/\.$/, "")}`)
      .join("; ")}.`,
    same
      ? "Every panel shows the very same individual subject at a different stage: the same kind, colours and markings, seen from the same viewpoint and camera distance, whole, so its size follows its stage, on the same plain light background."
      : "The panels are a matched set to compare side by side: each subject whole, seen from the same viewpoint, at the same scale, in the same light, on the same plain light background.",
    "No text anywhere in the image: no words, letters, labels, signs, captions or numbers.",
  ].join("\n");
  if (look?.style === "illustration") return lessonIllustrationPrompt(body, look);
  return housePhoto(look) ? housePhotoPrompt(body, look) : body;
}
