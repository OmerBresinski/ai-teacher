// the teacher's locale comes from their account, never hard-coded "England".
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
  /** the symbol prompts and slides write, "£", "₹" (never the ISO code:
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
/** The locale of the lesson being run (England until the account carries a country, TEACH-33 part b). */
export function setLocale(l: Locale | undefined): void {
  current = l ?? ENGLAND;
}
export const locale = (): Locale => current;

/** `text` with every {{locale.<field>}} token filled from `l`. */
export function localise(text: string, l: Locale = current): string {
  return text.replace(/\{\{\s*locale\.(\w+)\s*\}\}/g, (m, k: string) =>
    k in l ? String(l[k as keyof Locale]) : m,
  );
}
