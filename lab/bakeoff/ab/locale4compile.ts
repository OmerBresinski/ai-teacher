// Arm "locale4" $0: (1) the compiled requests (NZ, US, India, UK) in locale4 and base5 to
// BAKEOFF/ab/arms3/locale4/compiled/<arm>/<country>/*.txt; (2) the caption fix replayed on every saved
// NZ lesson behind ab/share/nz-uk, before and after, to arms3/locale4/captions.txt. No model calls.
// `bun lab/bakeoff/ab/locale4compile.ts`
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { AB } from "./arms";
import { localAlt, slideWords } from "./caption";
import { locale2Briefs } from "./locale2compile";
import { compileLocale, ukObjectives } from "./localecompile";

type El = { type?: string; alt?: string; request?: string };
type Slide = { id: string; elements?: El[] };

if (import.meta.main) {
  const out = `${AB}/arms3/locale4`;
  for (const arm of ["locale4", "base5"] as const)
    for (const [c, b] of Object.entries(locale2Briefs())) {
      mkdirSync(`${out}/compiled/${arm}/${c}`, { recursive: true });
      for (const [k, v] of Object.entries(compileLocale(arm, b, ukObjectives())))
        writeFileSync(`${out}/compiled/${arm}/${c}/${k}.txt`, v);
    }
  const lines: string[] = [];
  let seen = 0;
  let changed = 0;
  const runs = readdirSync(`${AB}/runs`)
    .filter((r) => /^nz/.test(r))
    .sort();
  for (const r of runs) {
    const T = `${AB}/runs/${r}/T`;
    if (!existsSync(T)) continue;
    for (const b of readdirSync(T).sort()) {
      const f = `${T}/${b}/lesson.json`;
      if (!existsSync(f)) continue;
      const brief = JSON.parse(readFileSync(`${T}/${b}/brief.json`, "utf8"));
      const country = brief.locale?.country ?? "England";
      if (country === "England") continue;
      const lesson = JSON.parse(readFileSync(f, "utf8")) as { slides: Slide[] };
      for (const s of lesson.slides)
        for (const e of s.elements ?? []) {
          if (e.type !== "image" || !e.alt) continue;
          seen++;
          const after = localAlt(e.alt, {
            country,
            context: `${slideWords(s)} ${brief.topic}`,
          });
          if (after === e.alt) continue;
          changed++;
          lines.push(`${r}/${b} ${s.id}\n  before: ${e.alt}\n  after:  ${after}`);
        }
    }
  }
  const head = `locale4 caption fix replayed at $0 on the saved NZ lessons (runs/nz*): ${seen} image alts, ${changed} changed.\n`;
  writeFileSync(`${out}/captions.txt`, `${head}\n${lines.join("\n\n")}\n`);
  console.log(head + lines.join("\n\n"));
}
