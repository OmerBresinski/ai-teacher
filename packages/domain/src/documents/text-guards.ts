/*
 * Deterministic text guards (Generation quality §3, §5; TEACH-210). Pure, dependency-free, shared by
 * the spec sanitiser in `@tj/slides` (a violation there is a validation issue the model retries
 * on) and by `checkLesson` (the same rules over a stored document). Nothing here reads content
 * into a log: callers report *that* a rule matched and where, never the matching text.
 */

/** The five named HTML entities the model sometimes writes into plain text, plus numeric ones. */
const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};
const ENTITY = /&(?:amp|lt|gt|quot|apos|#39);|&#(\d+);/g;

/** `Rodent Teeth &amp; Classifying` → `Rodent Teeth & Classifying`. A decoded string is never longer. */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (match, code: string | undefined) => {
    if (code !== undefined) {
      const n = Number(code);
      return Number.isInteger(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[match] ?? match;
  });
}

/**
 * House-rule and prompt vocabulary that has no place in front of a pupil (seen in production:
 * "Hand in your answers — no names needed"). Checked on every pupil-facing slot; never on notes.
 */
export const LEAKED_PUPIL_PHRASES: readonly RegExp[] = [
  /\bno names\b/i,
  /\bBritish English\b/i,
  /\bfact ids?\b/i,
  /\bfactRefs\b/i,
  /\bJSON\b/,
  /\bas (?:an? )?(?:AI|language model)\b/i,
];

/**
 * Repair commentary that belongs in a log, not in teacher notes ("Corrected the rodent definition
 * so that it matches…"). Checked on `notes` only.
 */
export const LEAKED_REPAIR_PHRASES: readonly RegExp[] = [
  /^\s*(?:corrected|fixed|updated|changed|as reported|per the finding)\b/i,
  /\bthe finding\b/i,
  /\bvalidation\b/i,
];

/** Whether any pupil-facing phrase matches; the caller reports the slot, not the text. */
export const hasLeakedPupilPhrase = (text: string): boolean =>
  LEAKED_PUPIL_PHRASES.some((re) => re.test(text));

export const hasLeakedRepairPhrase = (text: string): boolean =>
  LEAKED_REPAIR_PHRASES.some((re) => re.test(text));

/** Case- and whitespace-insensitive key for comparing two answer options or two stems. */
export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when every value is different under `normaliseText`. */
export function allDistinct(values: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    const key = normaliseText(value);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** True when `candidate` equals one of `values` under `normaliseText`. */
export function isOneOf(candidate: string, values: readonly string[]): boolean {
  const key = normaliseText(candidate);
  return values.some((value) => normaliseText(value) === key);
}

/** A classify task dressed as a sequence: the `sort` kind is for a genuine order only. */
const CLASSIFY_STEM = /\b(?:classify|sort into|group)\b/i;
export const isClassifyStem = (stem: string): boolean => CLASSIFY_STEM.test(stem);

/** Every step begins with the same word: a list of instances, not a sequence of steps. */
export function sameLeadingToken(steps: readonly string[]): boolean {
  if (steps.length < 2) return false;
  const first = (s: string) => normaliseText(s).split(" ")[0] ?? "";
  const lead = first(steps[0] ?? "");
  return lead.length > 0 && steps.every((s) => first(s) === lead);
}

/**
 * Two long claims joined by " and " (the Warcraft double statement): a true/false statement is one
 * claim a pupil can judge. Both halves must be longer than `minHalf` characters to count.
 */
export function isDoubleStatement(statement: string, minHalf = 60): boolean {
  const at = statement.indexOf(" and ");
  if (at === -1) return false;
  const left = statement.slice(0, at).trim();
  const right = statement.slice(at + 5).trim();
  return left.length > minHalf && right.length > minHalf;
}
