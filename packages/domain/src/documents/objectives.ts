/**
 * Learning objectives are stored once as a bare verb phrase ("Describe the arrangement of
 * particles in solids, liquids and gases") and rendered with the stem that fits the reader
 * (UX ruling 64, TEACH-198). The slide carries the stem in its heading and lists the phrases
 * under it; a worksheet header speaks for one pupil, so it carries the stem on the line itself.
 * No model call and no schema change: these are string helpers only.
 */

/** The objectives slide heading; the numbered lines under it complete the sentence. */
export const OBJECTIVES_SLIDE_HEADING = "By the end of this lesson I can";

/** "I can", "I can't" or "I cannot" at the start of the phrase, any case. */
const STEM_ALREADY = /^i can(?:'t|not)?\b/i;

/** A phrase that starts with the pronoun "I" ("I can", "I know") keeps its capital. */
const PRONOUN_I = /^I\b/;

/**
 * The phrase with its first letter lower-cased so it can follow a stem. The first character is
 * left alone when the first word is all capitals or its second character is upper-case (an
 * acronym or a proper noun such as "NASA" or "SI"), or when the phrase starts with the
 * pronoun "I". Trims the text; empty input gives an empty string.
 */
function lowerFirst(text: string): string {
  const phrase = text.trim();
  if (phrase === "") return "";
  if (PRONOUN_I.test(phrase)) return phrase;
  const first = phrase.charAt(0);
  if (first === first.toLowerCase()) return phrase;
  const word = phrase.split(/\s+/, 1)[0] ?? "";
  const allCapitals = word.length > 1 && /^[^a-z]+$/.test(word) && /[A-Z]{2}/.test(word);
  const second = phrase.charAt(1);
  if (allCapitals || (second !== "" && second !== second.toLowerCase())) return phrase;
  return first.toLowerCase() + phrase.slice(1);
}

/**
 * The objective as one pupil reads it: "I can " and the phrase with its first letter
 * lower-cased. A phrase that already starts with "I can" (or "I can't") comes back unchanged
 * apart from trimming, so the helper is idempotent. Empty or whitespace input gives "".
 */
export function pupilObjective(text: string): string {
  const phrase = text.trim();
  if (phrase === "") return "";
  if (STEM_ALREADY.test(phrase)) return `I${phrase.slice(1)}`;
  return `I can ${lowerFirst(phrase)}`;
}

/**
 * One line of a list under a shared stem (the slide heading): the phrase alone, first letter
 * lower-cased by the same rule. A phrase stored with its own "I can " is trimmed back to the
 * verb phrase so the stem is not said twice. Empty or whitespace input gives "".
 */
export function objectiveLine(text: string): string {
  const phrase = text.trim();
  const own = /^i can\s+/i.exec(phrase);
  return lowerFirst(own ? phrase.slice(own[0].length) : phrase);
}
