// Arm "locale3" $0 compile: the locale2 briefs (NZ seasons, the same brief for the US and India, UK) in
// locale3, locale2 and base4. `bun lab/bakeoff/ab/locale3compile.ts` writes
// BAKEOFF/ab/arms3/locale3/compiled/<arm>/<country>/{writer,objectives,objective-repair,director}.txt.
import { mkdirSync, writeFileSync } from "node:fs";
import { AB } from "./arms";
import { locale2Briefs } from "./locale2compile";
import { compileLocale, ukObjectives } from "./localecompile";

if (import.meta.main) {
  const out = `${AB}/arms3/locale3/compiled`;
  for (const arm of ["locale3", "locale2", "base4"] as const)
    for (const [c, b] of Object.entries(locale2Briefs())) {
      mkdirSync(`${out}/${arm}/${c}`, { recursive: true });
      for (const [k, v] of Object.entries(compileLocale(arm, b, ukObjectives())))
        writeFileSync(`${out}/${arm}/${c}/${k}.txt`, v);
    }
  console.log(`wrote ${out}/{locale3,locale2,base4}/{nz,us,in,uk}/*.txt`);
}
