/*
 * Identifier guard (ADR 0024 §2; F15-R03; principle P6). A pure, deterministic scan of free text
 * for things that look like a learner's identity: an email address, a "Firstname Surname" pair,
 * a long digit run (UPN, admission number) or a phrase that introduces a named pupil. It is a
 * structural guarantee, not a classifier: false positives are shown to the teacher as a request to
 * reword, so the heuristics are few and the allow-list is exported for the brief screen to show.
 *
 * Applied as a Zod refinement (`guarded`) to every free-text field of `Brief` and `ClassContext`,
 * so the client form and the API reject with the same `GUARD_MESSAGE`. Never applied to the lesson
 * body or title: that is the teacher's content, not class context.
 */
import type { z } from "zod";

export type NamePatternKind = "email" | "capitalised-pair" | "id-number" | "pupil-phrase";

export type NamePattern = {
  kind: NamePatternKind;
  /** The offending text exactly as it appears in the input. */
  match: string;
  /** Offset of `match` in the input. */
  index: number;
};

export const GUARD_MESSAGE = "Remove pupil names or identifiers before saving.";

/**
 * Capitalised words that never count towards a "Firstname Surname" pair. A pair is allowed when
 * either of its words is listed. Kept deliberately small: curriculum vocabulary, months, and the
 * eras and places that head most primary topics. Case-sensitive, as written.
 */
export const CAPITALISED_ALLOW_LIST: readonly string[] = [
  // Curriculum structure
  "Year",
  "Key",
  "Stage",
  "National",
  "Curriculum",
  "Reception",
  "Nursery",
  "Early",
  "Years",
  "Foundation",
  "Primary",
  "Secondary",
  "Lesson",
  "Unit",
  "Term",
  "Autumn",
  "Spring",
  "Summer",
  // Subjects
  "Maths",
  "Mathematics",
  "English",
  "Science",
  "History",
  "Geography",
  "Art",
  "Design",
  "Technology",
  "Music",
  "Computing",
  "Physical",
  "Education",
  "Religious",
  "Studies",
  "Modern",
  "Foreign",
  "Languages",
  "French",
  "Spanish",
  "German",
  "Latin",
  "Drama",
  "Citizenship",
  "Phonics",
  "Reading",
  "Writing",
  // Months
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  // Common topic heads (eras, places)
  "Ancient",
  "Roman",
  "Romans",
  "Britain",
  "British",
  "Great",
  "United",
  "Kingdom",
  "Greece",
  "Greeks",
  "Egypt",
  "Egyptians",
  "Stone",
  "Bronze",
  "Iron",
  "Age",
  "Tudor",
  "Tudors",
  "Victorian",
  "Victorians",
  "Anglo",
  "Saxons",
  "Vikings",
  "World",
  "War",
  "Europe",
  "Africa",
  "Asia",
  "America",
  "North",
  "South",
  "East",
  "West",
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const ID_NUMBER = /\d{6,}/g;
const PUPIL_PHRASE = /\b(?:pupil|student|child|learner|boy|girl)\s+(?:called|named)\b/gi;
/** A capitalised word of two or more letters (so "I" and "A" do not count). */
const CAPITALISED_WORD = /\b[A-Z][a-z]+\b/g;
/** Whitespace that may sit between two words of one name. */
const SINGLE_GAP = /^[ \t]+$/;
/** What may precede a word for it to count as the start of a sentence. */
const SENTENCE_BOUNDARY = /(?:^|[.!?:;\n\r("'“‘])\s*$/;

function collect(text: string, pattern: RegExp, kind: NamePatternKind): NamePattern[] {
  const out: NamePattern[] = [];
  for (const m of text.matchAll(pattern)) out.push({ kind, match: m[0], index: m.index });
  return out;
}

function capitalisedPairs(text: string): NamePattern[] {
  const words = [...text.matchAll(CAPITALISED_WORD)].map((m) => ({
    word: m[0],
    index: m.index,
  }));
  const allow = new Set(CAPITALISED_ALLOW_LIST);
  const out: NamePattern[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const first = words[i];
    const second = words[i + 1];
    if (first === undefined || second === undefined) break;
    const gap = text.slice(first.index + first.word.length, second.index);
    if (!SINGLE_GAP.test(gap)) continue;
    if (SENTENCE_BOUNDARY.test(text.slice(0, first.index))) continue;
    if (allow.has(first.word) || allow.has(second.word)) continue;
    out.push({
      kind: "capitalised-pair",
      match: `${first.word}${gap}${second.word}`,
      index: first.index,
    });
    // "Amir Khan Smith" is one name, not two: do not re-flag the shared word.
    i++;
  }
  return out;
}

/** Every identifier-like pattern in `text`, in order of appearance. `[]` means the text is clean. */
export function findNamePatterns(text: string): NamePattern[] {
  return [
    ...collect(text, EMAIL, "email"),
    ...collect(text, ID_NUMBER, "id-number"),
    ...collect(text, PUPIL_PHRASE, "pupil-phrase"),
    ...capitalisedPairs(text),
  ].sort((a, b) => a.index - b.index);
}

/** Refine a string schema with the Identifier guard. */
export function guarded(schema: z.ZodString): z.ZodString {
  return schema.refine((s) => findNamePatterns(s).length === 0, { message: GUARD_MESSAGE });
}
