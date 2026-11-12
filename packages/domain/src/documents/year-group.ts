/*
 * Which year group a lesson is for, read strictly (founder's ruling, 12 Nov 2026: "make an
 * unrecognised year group ask the teacher, not guess"). A year group is recognised only when it
 * is exactly one of the England years the intake offers; anything else, and any other year,
 * grade or stage the topic names, asks the teacher instead of being mapped to the nearest key
 * stage. The intake, `POST /lessons`, `POST /lessons/:id/plan` and the writer all read it here.
 */

/** The year groups a lesson can be made for: the intake's list, Year 1 to Year 13. */
export const SUPPORTED_YEAR_GROUPS: readonly string[] = Array.from(
  { length: 13 },
  (_, i) => `Year ${i + 1}`,
);

/**
 * The supported year group a label names, as the list spells it: "Year 5", "year 5", "Y5",
 * "Yr 5", "yr. 5" → "Year 5". Undefined for anything else: blank, "P5", "Grade 4", "S2",
 * "Reception", "Year 14", "Year 5 Scotland", "Years 5 and 6".
 */
export function recogniseYearGroup(label: string | undefined | null): string | undefined {
  if (typeof label !== "string") return undefined;
  const text = label.trim().replace(/\s+/g, " ").toLowerCase();
  const match = /^(?:year|yr\.?|y)\s?(\d{1,2})$/.exec(text);
  if (match === null) return undefined;
  const year = Number(match[1]);
  return year >= 1 && year <= SUPPORTED_YEAR_GROUPS.length ? `Year ${year}` : undefined;
}

/** A year, grade or stage the topic names, with the England years it covers when it is one. */
export type YearMention = { said: string; years?: readonly [number, number] };

const KEY_STAGE_YEARS: Record<string, readonly [number, number]> = {
  "1": [1, 2],
  "2": [3, 6],
  "3": [7, 9],
  "4": [10, 11],
  "5": [12, 13],
};

const englishYears = (lo: number, hi: number): readonly [number, number] | undefined =>
  lo >= 1 && hi <= SUPPORTED_YEAR_GROUPS.length && lo <= hi ? [lo, hi] : undefined;

type Rule = { pattern: RegExp; years?: (match: RegExpExecArray) => YearMention["years"] };

/**
 * What the topic scan reads. Bare `Y5`, `P5` and `S2` must be capitals, so maths like "x2 + y2"
 * is not a year; Reception and nursery need a class word, so "nursery rhymes" and "hotel
 * reception" are not stages.
 */
const RULES: readonly Rule[] = [
  {
    pattern:
      /\b(?:years?|yrs?)\.?\s*(\d{1,2})(?:\s*(?:-|–|\/|to|and|&)\s*(?:(?:years?|yrs?|y)\.?\s*)?(\d{1,2}))?\b/gi,
    years: (m) => englishYears(Number(m[1]), Number(m[2] ?? m[1])),
  },
  {
    pattern: /\bY(\d{1,2})(?:\/(\d{1,2}))?\b/g,
    years: (m) => englishYears(Number(m[1]), Number(m[2] ?? m[1])),
  },
  {
    pattern: /\b(?:ks|key\s*stage)\s*([1-5])\b/gi,
    years: (m) => KEY_STAGE_YEARS[m[1] as string],
  },
  { pattern: /\bsixth[\s-]form\b/gi, years: () => [12, 13] },
  { pattern: /\bprimary\s*\d{1,2}\b/gi },
  { pattern: /\bP[1-7]\b/g },
  { pattern: /\bsecondary\s*\d{1,2}\b/gi },
  { pattern: /\bS[1-6]\b/g },
  { pattern: /\bgrade\s*\d{1,2}\b/gi },
  { pattern: /\b\d{1,2}(?:st|nd|rd|th)\s+(?:grade|class|year|form)\b/gi },
  { pattern: /\b(?:junior|senior)\s+infants\b/gi },
  {
    pattern: /(?<=\b(?:for|in)\s+)reception\b|\breception(?=\s+(?:class|pupils|children|kids)\b)/gi,
  },
  {
    pattern:
      /\bnursery(?=\s+(?:class|pupils|children|kids)\b)|\beyfs\b|\bkindergarten\b|\bpre-?k\b/gi,
  },
];

/** Every year, grade or stage the text names, in order. */
export function yearMentionsIn(text: string | undefined): YearMention[] {
  if (!text) return [];
  const found: { index: number; end: number; mention: YearMention }[] = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const index = match.index ?? 0;
      const end = index + match[0].length;
      if (found.some((f) => index < f.end && end > f.index)) continue;
      const years = rule.years?.(match as RegExpExecArray);
      found.push({ index, end, mention: { said: match[0].trim(), ...(years ? { years } : {}) } });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.mention);
}

/**
 * The mentions that disagree with the chosen year: another England year, a stage the year is
 * not in, or a grade, P-level or class that is not an England year. For Years 10 and 11, and
 * when the topic names GCSE, "grade 4" is a GCSE grade, not a class.
 */
export function conflictingMentions(yearGroup: string, text: string | undefined): YearMention[] {
  const year = Number(/\d+/.exec(yearGroup)?.[0]);
  const gcse = year === 10 || year === 11 || /\bgcses?\b/i.test(text ?? "");
  return yearMentionsIn(text).filter((mention) => {
    if (gcse && /^grade\s*\d/i.test(mention.said)) return false;
    return mention.years === undefined || year < mention.years[0] || year > mention.years[1];
  });
}

/**
 * The key the teacher's answer is held against: the topic's year mentions. An answer stays good
 * while the topic names the same years, and is asked again when it names a new one.
 */
export function yearMentionKey(text: string | undefined): string {
  return yearMentionsIn(text)
    .map((m) => m.said.toLowerCase())
    .join("|");
}

/** Why the year group has to be asked: none chosen, one not on the list, or a topic naming another. */
export type YearGroupProblem =
  | { reason: "missing" }
  | { reason: "unrecognised"; said: string }
  | { reason: "conflict"; said: string };

/**
 * Whether the lesson's year group can go to generation as it is. `confirmed` is the teacher's
 * answer to the conflict question ("Your topic says P5…"): it settles a conflict, never an
 * unrecognised or missing year group.
 */
export function yearGroupProblem(
  yearGroup: string | undefined | null,
  topic: string | undefined,
  confirmed = false,
): YearGroupProblem | undefined {
  if (typeof yearGroup !== "string" || yearGroup.trim() === "") return { reason: "missing" };
  const year = recogniseYearGroup(yearGroup);
  if (year === undefined) return { reason: "unrecognised", said: yearGroup.trim() };
  if (confirmed) return undefined;
  const clash = conflictingMentions(year, topic)[0];
  return clash ? { reason: "conflict", said: clash.said } : undefined;
}

/** The question the intake asks, and the field's empty state. */
export const YEAR_GROUP_QUESTION = "Which year group is this for?";
export const YEAR_GROUP_PLACEHOLDER = "Choose a year group";

/** The plain words the intake (and the API's refusal) use for a problem. */
export function yearGroupMessage(problem: YearGroupProblem): string {
  if (problem.reason === "missing") return `${YEAR_GROUP_QUESTION} Choose one from the list.`;
  if (problem.reason === "unrecognised")
    return `“${problem.said}” isn’t on our list. ${YEAR_GROUP_QUESTION}`;
  return `Your topic says “${problem.said}”. ${YEAR_GROUP_QUESTION}`;
}
