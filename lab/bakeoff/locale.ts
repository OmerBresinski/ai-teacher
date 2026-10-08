// Round 8 (Greg): the teacher's locale comes from their account, never hard-coded "England".
// Prompt files carry {{locale.<field>}} tokens; `localise` fills them on every model call
// (services.ts chat / chatStream), so the generators keep one source per prompt.
export type Locale = {
  /** "England", "India". */
  country: string;
  /** "the National Curriculum for England", "CBSE". */
  curriculum: string;
  /** How a year group is named: "Year" (Year 8), "Class" (Class 8), "Grade" (Grade 8). */
  yearWord: string;
  /** Spelling and search locale: "en-GB", "en-IN", "en-US". */
  spelling: string;
  /** Round 9 (audit cause 7): the symbol prompts and slides write, "£", "₹" (never the ISO code:
   * "GBP 48" made y5's bar part "12 GBP" too wide and read as a code, not money). */
  currency: string;
  /** The ISO 4217 code, for anything that needs it (prices, APIs); never filled into prompts as money. */
  currencyCode: string;
  /** "metric", "imperial". */
  units: string;
};

export const ENGLAND: Locale = {
  country: "England",
  curriculum: "the National Curriculum for England",
  yearWord: "Year",
  spelling: "en-GB",
  currency: "£",
  currencyCode: "GBP",
  units: "metric",
};

export const INDIA: Locale = {
  country: "India",
  curriculum: "CBSE",
  yearWord: "Class",
  spelling: "en-IN",
  currency: "₹",
  currencyCode: "INR",
  units: "metric",
};

let current: Locale = ENGLAND;
/** The locale of the lesson being run (runLesson sets it from the brief; rounds keep England). */
export function setLocale(l: Locale | undefined): void {
  current = l ?? ENGLAND;
}
export const locale = (): Locale => current;

/** England is the prompts' home: a locale-neutral prompt reads for it exactly as base4 did. */
export const isEngland = (l: Locale | undefined): boolean => !l || l.country === ENGLAND.country;

/**
 * Tokens computed from the locale (arm "locale", 8 Oct). {{locale.setting}} is the country line's
 * second sentence, with its leading space: empty for England, so England's prompt stays byte-exact.
 */
const COMPUTED: Record<string, (l: Locale) => string> = {
  setting: (l) =>
    isEngland(l) ? "" : ` Follow the curriculum, conventions and setting of ${l.country}.`,
  // Arm "locale2" (8 Oct): the NZ locale run named Aotearoa and pōhutukawa but kept no months,
  // hemisphere or festivals. Kinds of place fact, gated on the topic; no facts about any country.
  place: (l) =>
    isEngland(l)
      ? ""
      : ` Where the topic depends on place, use what is true for pupils in ${l.country}: which months each season falls in, the hemisphere, the climate, local plants and animals, festivals, currency and units.`,
  // Arm "locale3" (8 Oct, Greg): locale2 without the list. The list named kinds of fact (months,
  // currency, units) that a non-place topic could pull in for their own sake; the model judges.
  placeShort: (l) =>
    isEngland(l)
      ? ""
      : ` Where the topic depends on place, use what is true for pupils in ${l.country}.`,
};

/** `text` with every {{locale.<field>}} token filled from `l`. */
export function localise(text: string, l: Locale = current): string {
  return text.replace(/\{\{\s*locale\.(\w+)\s*\}\}/g, (m, k: string) =>
    k in COMPUTED
      ? (COMPUTED[k] as (l: Locale) => string)(l)
      : k in l
        ? String(l[k as keyof Locale])
        : m,
  );
}
