// Arm "locale2" $0 compile: the NZ seasons brief and the same brief for the US and India, in locale2,
// locale and base4, plus the UK brief (England byte-exact). `bun lab/bakeoff/ab/locale2compile.ts`
// writes BAKEOFF/ab/arms3/locale2/compiled/<arm>/<country>/{writer,objectives,objective-repair,director}.txt.
import { mkdirSync, writeFileSync } from "node:fs";
import type { Brief } from "../harness";
import { INDIA, type Locale } from "../locale";
import { AB } from "./arms";
import { compileLocale, nzUkBrief, ukObjectives } from "./localecompile";

export const US: Locale = {
  country: "the United States",
  curriculum: "the state standards",
  yearWord: "Grade",
  spelling: "en-US",
  currency: "$",
  currencyCode: "USD",
  units: "imperial",
};

/** The NZ seasons brief moved to another country, with that country's year naming. */
export const movedBrief = (l: Locale, yearGroup: string): Brief => ({
  ...nzUkBrief("nz"),
  id: `y1-science-seasons-${l.currencyCode.toLowerCase()}`,
  yearGroup,
  readingLevel: yearGroup,
  language: l.spelling,
  locale: l,
});

export const locale2Briefs = (): Record<"nz" | "us" | "in" | "uk", Brief> => ({
  nz: nzUkBrief("nz"),
  us: movedBrief(US, "Grade 1"),
  in: movedBrief(INDIA, "Class 1"),
  uk: nzUkBrief("uk"),
});

if (import.meta.main) {
  const out = `${AB}/arms3/locale2/compiled`;
  for (const arm of ["locale2", "locale", "base4"] as const)
    for (const [c, b] of Object.entries(locale2Briefs())) {
      mkdirSync(`${out}/${arm}/${c}`, { recursive: true });
      for (const [k, v] of Object.entries(compileLocale(arm, b, ukObjectives())))
        writeFileSync(`${out}/${arm}/${c}/${k}.txt`, v);
    }
  console.log(`wrote ${out}/{locale2,locale,base4}/{nz,us,in,uk}/*.txt`);
}
