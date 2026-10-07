import { z } from "zod";

/*
 * The account's country and what it sets in everything Dayback writes (TEACH-33 part b, UX ruling
 * 183, amending 158): spelling, the currency symbol, units, the classroom the prompts speak from,
 * and, for later work, the curriculum and the year-group naming. England is the default, so a
 * lesson with no `country` reads exactly as before. Pure data; nothing here reads the environment.
 */

/** The countries an account can choose, in the order Settings lists them. Stored as the id. */
export const COUNTRIES = [
  "england",
  "wales",
  "scotland",
  "northern-ireland",
  "ireland",
  "india",
  "usa",
  "australia",
] as const;
export type Country = (typeof COUNTRIES)[number];
export const CountrySchema = z.enum(COUNTRIES);
export const DEFAULT_COUNTRY: Country = "england";

export type UnitSystem = "metric" | "us-customary";

export type Locale = {
  country: Country;
  /** How Settings names the country. */
  label: string;
  /** BCP-47 tag a new lesson's `language` takes (spellcheck, hyphenation, `Language:` line). */
  language: string;
  /** The spelling the prompts ask for, as written in the house rule ("British English"). */
  spelling: string;
  /** The teacher a prompt casts the model as ("UK teacher"). */
  teacher: string;
  /** `CurriculumRef.scheme` for this country and its name in words. */
  curriculum: { scheme: string; name: string };
  /** The word before a year-group number, and the ladder in words. */
  yearNaming: { word: "Year" | "Class" | "Grade" | "P"; groups: string };
  currency: { symbol: string; code: string; name: string };
  units: UnitSystem;
};

const UK = {
  language: "en-GB",
  spelling: "British English",
  teacher: "UK teacher",
  currency: { symbol: "£", code: "GBP", name: "pounds and pence" },
  units: "metric",
} as const;

const LOCALES: Record<Country, Locale> = {
  england: {
    country: "england",
    label: "England",
    ...UK,
    curriculum: { scheme: "NC2014", name: "the National Curriculum in England" },
    yearNaming: { word: "Year", groups: "Reception, then Year 1 to Year 13" },
  },
  wales: {
    country: "wales",
    label: "Wales",
    ...UK,
    curriculum: { scheme: "CfW", name: "the Curriculum for Wales" },
    yearNaming: { word: "Year", groups: "Reception, then Year 1 to Year 13" },
  },
  scotland: {
    country: "scotland",
    label: "Scotland",
    ...UK,
    curriculum: { scheme: "CfE", name: "Curriculum for Excellence" },
    yearNaming: { word: "P", groups: "P1 to P7, then S1 to S6" },
  },
  "northern-ireland": {
    country: "northern-ireland",
    label: "Northern Ireland",
    ...UK,
    curriculum: { scheme: "NIC", name: "the Northern Ireland Curriculum" },
    yearNaming: { word: "P", groups: "P1 to P7, then Year 8 to Year 14" },
  },
  ireland: {
    country: "ireland",
    label: "Ireland",
    language: "en-IE",
    spelling: "Irish English",
    teacher: "Irish teacher",
    curriculum: { scheme: "NCCA", name: "the Primary Curriculum and the Junior Cycle" },
    yearNaming: {
      word: "Class",
      groups: "Junior Infants to Sixth Class, then First to Sixth Year",
    },
    currency: { symbol: "€", code: "EUR", name: "euro and cent" },
    units: "metric",
  },
  india: {
    country: "india",
    label: "India",
    language: "en-IN",
    spelling: "Indian English",
    teacher: "Indian teacher",
    curriculum: { scheme: "CBSE", name: "the CBSE curriculum (NCERT)" },
    yearNaming: { word: "Class", groups: "Class 1 to Class 12" },
    currency: { symbol: "₹", code: "INR", name: "rupees and paise" },
    units: "metric",
  },
  usa: {
    country: "usa",
    label: "United States",
    language: "en-US",
    spelling: "American English",
    teacher: "American teacher",
    curriculum: { scheme: "CCSS", name: "the Common Core State Standards" },
    yearNaming: { word: "Grade", groups: "Kindergarten, then Grade 1 to Grade 12" },
    currency: { symbol: "$", code: "USD", name: "dollars and cents" },
    units: "us-customary",
  },
  australia: {
    country: "australia",
    label: "Australia",
    language: "en-AU",
    spelling: "Australian English",
    teacher: "Australian teacher",
    curriculum: { scheme: "ACARA", name: "the Australian Curriculum" },
    yearNaming: { word: "Year", groups: "Foundation, then Year 1 to Year 12" },
    currency: { symbol: "$", code: "AUD", name: "dollars and cents" },
    units: "metric",
  },
};

/** The locale a country sets; a missing or unknown country is England's (lessons saved before). */
export function localeFor(country: string | undefined | null): Locale {
  return CountrySchema.safeParse(country).success
    ? LOCALES[country as Country]
    : LOCALES[DEFAULT_COUNTRY];
}

/** Every locale, in `COUNTRIES` order (Settings lists them). */
export const LOCALE_LIST: readonly Locale[] = COUNTRIES.map((c) => LOCALES[c]);

/** True when the locale words a prompt exactly as England does (no substitution, same hash). */
export function speaksLikeEngland(locale: Locale): boolean {
  const england = LOCALES[DEFAULT_COUNTRY];
  return (
    locale.spelling === england.spelling &&
    locale.teacher === england.teacher &&
    locale.currency.code === england.currency.code &&
    locale.units === england.units
  );
}
