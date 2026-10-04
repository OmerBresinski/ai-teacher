import { SPEC_LIMITS } from "./specs";

/*
 * The COMMON MISTAKE card's text (TEACH-87, UX ruling 149): composed in code from a misconception's
 * structured fields, never written free by a slide writer, so it cannot read as a fact:
 *
 *   Thinking that {belief}. In fact, {correction}.
 *
 * Both planners feed it: the belief is the wrong idea as a clause that follows "Thinking that", the
 * correction the true statement in one short sentence. Older facts (a capital, a leading "that", a
 * full stop) are normalised here. The text is never shortened or summarised: past the card's limit,
 * or when the slide's key idea already says the correction, the card holds the belief alone and the
 * caller keeps the correction in the notes.
 */

export const MISCONCEPTION_LEAD = "Thinking that";
const IN_FACT = "In fact,";

/** Words, crudely stemmed, for the key-idea overlap below. */
const STOP = new Set(
  "the a an and or but of to in on at by for with from as is are was were be been it its that this they their them than then into not do does did no".split(
    " ",
  ),
);
function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(
    words
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "").replace(/e$/, "")),
  );
}

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

/** A belief as a clause after "Thinking that": no leading "that", no capital, no closing stop. */
export function normaliseBelief(belief: string, context = ""): string {
  const clause = belief
    .trim()
    .replace(/^(thinking|believing)\s+that\s+/i, "")
    .replace(/^that\s+/i, "")
    .replace(/[\s.!;:,]+$/, "");
  return lowerFirst(clause, context);
}

/** The card's text, or undefined when there is no belief to show (the caller drops the card). */
export function composeMisconception(
  belief: string | undefined,
  correction: string | undefined,
  options: { limit?: number; keyIdeas?: readonly string[] } = {},
): { text: string; correctionShown: boolean } | undefined {
  const limit = options.limit ?? SPEC_LIMITS.callout;
  const keys = options.keyIdeas ?? [];
  const clause = normaliseBelief(belief ?? "", [correction ?? "", ...keys].join(". "));
  if (!/[a-z0-9]/i.test(clause)) return undefined;
  const short = `${MISCONCEPTION_LEAD} ${clause}.`;
  if (short.length > limit) return undefined;
  const fact = (correction ?? "").trim().replace(/\s+/g, " ");
  if (!/[a-z0-9]/i.test(fact)) return { text: short, correctionShown: false };
  const words = contentWords(fact);
  const said = (options.keyIdeas ?? []).some((k) => {
    const key = contentWords(k);
    return words.size > 0 && [...words].filter((w) => key.has(w)).length / words.size >= 0.6;
  });
  const closed = /[.!?]$/.test(fact) ? fact : `${fact}.`;
  const full = `${short} ${IN_FACT} ${lowerFirst(closed, [belief ?? "", ...keys].join(". "))}`;
  if (said || full.length > limit) return { text: short, correctionShown: false };
  return { text: full, correctionShown: true };
}

/** The belief-alone form of a composed card, for a renderer whose room cannot hold the whole. */
export function shortMisconception(text: string): string | undefined {
  if (!text.startsWith(`${MISCONCEPTION_LEAD} `)) return undefined;
  const at = text.indexOf(`. ${IN_FACT} `);
  return at < 0 ? undefined : text.slice(0, at + 1);
}
