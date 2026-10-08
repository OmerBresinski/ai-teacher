// Arm "exit1" $0 England-vs-NZ parity: the locale2 briefs compiled for exit1 and base6.
// `bun lab/bakeoff/ab/exit1compile.ts` writes BAKEOFF/ab/arms3/exit1/compiled/<arm>/<country>/*.txt.
import { mkdirSync, writeFileSync } from "node:fs";
import { AB } from "./arms";
import { locale2Briefs } from "./locale2compile";
import { compileLocale, ukObjectives } from "./localecompile";

if (import.meta.main) {
  const out = `${AB}/arms3/exit1/compiled`;
  for (const arm of ["exit1", "base6"] as const)
    for (const [c, b] of Object.entries(locale2Briefs())) {
      mkdirSync(`${out}/${arm}/${c}`, { recursive: true });
      for (const [k, v] of Object.entries(compileLocale(arm, b, ukObjectives())))
        writeFileSync(`${out}/${arm}/${c}/${k}.txt`, v);
    }
  console.log(`wrote ${out}/{exit1,base6}/{nz,us,in,uk}/*.txt`);
}
