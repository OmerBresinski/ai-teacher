/**
 * Regenerates `src/writer/objectives-room.gen.json`: for each prompt stage and 2 to 4 objectives,
 * the longest objective line, in characters, at which the objectives slide (`layoutTemplate`
 * "objectives", full width, no figure) holds that many such lines at the body size or larger, with
 * nothing over, in every theme. The pupil-wording call is asked for lines within it and its lines
 * are checked against it (`pupilCharLimit`, `pupilLinesProblem` in `src/writer/fixes.ts`).
 *
 *   bun scripts/objectives-room.ts            write the table
 *   bun scripts/objectives-room.ts --check    exit 1 when the table is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { layoutTemplate, templateScale } from "@tj/slides/templates";
import { THEMES } from "@tj/slides/themes";

/** Plain pupil wording, cut at a word boundary to the length tried. */
export const ROOM_SAMPLE =
  "Describe how the roots take in water from the soil and hold the plant in place while the stem carries water up to the leaves and flowers";
export const sampleLine = (chars: number) => {
  let out = "";
  for (const w of ROOM_SAMPLE.split(" ")) {
    if (`${out} ${w}.`.trim().length > chars) break;
    out = `${out} ${w}`.trim();
  }
  return `${out}.`;
};
const STAGES = { KS1: "ks1", KS2: "ks2", "KS3-5": "ks3" } as const;

/** n lines of `chars` hold at the body size or larger in every theme at `stage`. */
export function roomHolds(stage: "ks1" | "ks2" | "ks3", n: number, chars: number): boolean {
  const points = Array.from({ length: n }, () => sampleLine(chars));
  return THEMES.every((theme) => {
    const r = layoutTemplate(
      { template: "objectives", heading: "Today we are learning to", points },
      theme,
      stage,
    );
    const body = templateScale(theme, stage).body;
    const items = r.slide.elements.filter((e) => e.type === "text" && e.name === "Item");
    return (
      r.over.length === 0 &&
      items.every((e) => e.type === "text" && (e.style.fontSize ?? 0) >= body)
    );
  });
}

export function objectivesRoomTable(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [key, stage] of Object.entries(STAGES)) {
    out[key] = {};
    for (const n of [2, 3, 4]) {
      let best = 0;
      for (let c = 20; c <= ROOM_SAMPLE.length; c += 2) if (roomHolds(stage, n, c)) best = c;
      (out[key] as Record<string, number>)[`${n} objectives`] = best;
    }
  }
  return out;
}

if (import.meta.main) {
  const file = new URL("../src/writer/objectives-room.gen.json", import.meta.url);
  const table = objectivesRoomTable();
  const text = `{\n${Object.entries(table)
    .map(
      ([k, v]) =>
        `  ${JSON.stringify(k)}: { ${Object.entries(v)
          .map(([n, c]) => `${JSON.stringify(n)}: ${c}`)
          .join(", ")} }`,
    )
    .join(",\n")}\n}\n`;
  if (process.argv.includes("--check")) {
    const same = readFileSync(file, "utf8") === text;
    console.log(same ? "objectives-room.gen.json is current" : "objectives-room.gen.json is stale");
    process.exit(same ? 0 : 1);
  }
  writeFileSync(file, text);
  console.log(text);
}
