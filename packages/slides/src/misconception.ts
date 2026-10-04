import { SPEC_LIMITS } from "./specs";

/*
 * The COMMON MISTAKE card's text (TEACH-87, UX ruling 149, revised 4 Oct): composed in code from a
 * misconception's structured fields, never written free by a slide writer. The belief is quoted in
 * the pupil's voice and the correction always follows it:
 *
 *   "Printing more money makes everyone richer." In fact, there are no more goods to buy, so prices just rise.
 *
 * A quoted belief is never shown without its correction: with no correction, or a text past the
 * card's limit, there is no card and the caller keeps the misconception in the notes. The text is
 * never shortened or summarised. Older facts (a clause after "believes", a leading "that", no
 * capital or full stop) are normalised here.
 */

const IN_FACT = "In fact,";

/**
 * Lower-cases the first letter unless the first word is a name: "I", an acronym, or a word the
 * context also writes with a capital away from a sentence start ("Germany").
 */
function lowerFirst(text: string, context: string): string {
  const first = /^[A-Za-z][\w-]*/.exec(text)?.[0];
  if (!first || first === "I" || /^[A-Z]{2,}/.test(first) || !/^[A-Z]/.test(first)) return text;
  const rest = `${context}. ${text.slice(first.length)}`;
  const named = new RegExp(`[a-z,;:]\\s+${first}\\b`).test(rest);
  return named ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/** A belief as the pupil would say it: one sentence, a capital, closing punctuation, no quotes. */
export function normaliseBelief(belief: string): string {
  const said = belief
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/^(thinking|believing)\s+that\s+/i, "")
    .replace(/^that\s+/i, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
  if (!/[a-z0-9]/i.test(said)) return "";
  const capped = said.charAt(0).toUpperCase() + said.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/** The card's text, or undefined when it cannot be shown whole (the caller drops the card). */
export function composeMisconception(
  belief: string | undefined,
  correction: string | undefined,
  options: { limit?: number } = {},
): string | undefined {
  const limit = options.limit ?? SPEC_LIMITS.callout;
  const said = normaliseBelief(belief ?? "");
  const fact = (correction ?? "").trim().replace(/\s+/g, " ");
  if (!said || !/[a-z0-9]/i.test(fact)) return undefined;
  const closed = /[.!?]$/.test(fact) ? fact : `${fact}.`;
  const text = `"${said}" ${IN_FACT} ${lowerFirst(closed, belief ?? "")}`;
  return text.length <= limit ? text : undefined;
}
