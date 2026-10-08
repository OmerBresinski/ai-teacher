// BAKEOFF arm T: writes BAKEOFF/catalogue/T.json (templates, slots, measured capacity per key stage).
// Usage: bun packages/slides/scripts/catalogue.ts [outPath]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { measureTemplate, TEMPLATE_DOCS } from "../src/templates/capacity";
import { getTheme } from "../src/themes";

const OUT = process.argv[2] ?? "T.json";
// KS1 and KS2 on Splash, KS3-5 on Studio (one scale for KS3, KS4 and KS5).
const STAGES = [
  { key: "KS1", stage: "ks1", theme: "splash" },
  { key: "KS2", stage: "ks2", theme: "splash" },
  { key: "KS3-5", stage: "ks3", theme: "studio" },
] as const;
const templates = TEMPLATE_DOCS.map((doc) => ({
  id: doc.id,
  use: doc.use,
  slots: doc.slots,
  capacity: Object.fromEntries(
    STAGES.map(({ key, stage, theme }) => [key, measureTemplate(doc, getTheme(theme), stage)]),
  ),
}));
const out = {
  arm: "T",
  generated: new Date().toISOString(),
  how: "Measured by laying each template out (packages/slides/src/templates) with real words cut at word boundaries; maxCharsPerItem is the longest every text item in that variant (lead, points, questions, options, captions, column texts) can be with nothing over the slide's band. headingMax: the heading in at most 2 lines. charsPerLine: one line of the slot's column at its type size. Slide is 960x540; KS1-2 on Splash, KS3-5 on Studio, sizes from the one key-stage type scale.",
  templates,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
for (const t of templates)
  console.log(
    t.id.padEnd(17),
    Object.entries(t.capacity)
      .map(
        ([k, c]) =>
          `${k} h${c.headingMax} ${c.variants.map((v) => `${v.label}:${v.maxCharsPerItem}`).join(",")}`,
      )
      .join(" | "),
  );
