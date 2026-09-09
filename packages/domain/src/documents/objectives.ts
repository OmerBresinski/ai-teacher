/**
 * Learning objectives are stored once as a bare verb phrase ("Describe the arrangement of
 * particles in solids, liquids and gases") and rendered with the stem that fits the reader
 * (UX ruling 64, TEACH-198). The slide carries the stem in its heading and lists the phrases
 * under it; a worksheet header speaks for one pupil, so it carries the stem on the line itself.
 * No model call and no schema change: these are string helpers only.
 */

/** The objectives slide heading; the numbered lines under it complete the sentence. */
export const OBJECTIVES_SLIDE_HEADING = "By the end of this lesson I can";

/**
 * "I can", "I can't" or "I cannot" at the start of the phrase, any case: the one definition of
 * "the phrase already carries its stem", shared by both helpers. The word boundary keeps a word
 * that merely starts with "can" ("I candle") out.
 */
const STEM_ALREADY = /^i can(?:'t|not)?\b/i;

/** A phrase that starts with the pronoun "I" ("I can", "I know") keeps its capital. */
const PRONOUN_I = /^I\b/;

/**
 * The phrase with its first letter lower-cased so it can follow a stem. The first character is
 * left alone when the second character is upper-case (an acronym or a proper noun such as
 * "NASA" or "SI"; an all-capitals word is the same case, since its second letter is a capital),
 * or when the phrase starts with the pronoun "I". Trims the text; empty input gives an empty
 * string.
 */
function lowerFirst(text: string): string {
  const phrase = text.trim();
  if (phrase === "") return "";
  if (PRONOUN_I.test(phrase)) return phrase;
  const first = phrase.charAt(0);
  if (first === first.toLowerCase()) return phrase;
  const second = phrase.charAt(1);
  if (second !== "" && second !== second.toLowerCase()) return phrase;
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
 * verb phrase so the stem is not said twice. A negative stem ("I can't", "I cannot") is not the
 * heading's stem and cannot be cut without changing the meaning, so the phrase is left whole,
 * capital "I" and all: the teacher sees the stored text and can fix it. Empty or whitespace
 * input gives "".
 */
export function objectiveLine(text: string): string {
  const phrase = text.trim();
  const own = STEM_ALREADY.exec(phrase);
  if (!own) return lowerFirst(phrase);
  if (own[0].toLowerCase() !== "i can") return `I${phrase.slice(1)}`;
  return lowerFirst(phrase.slice(own[0].length));
}
