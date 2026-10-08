// faults-3-6-8 #8 ($0): the gas8 check over every saved y11 lesson (lesson.json, slide by slide).
// bun lab/bakeoff/ab/gas8scan.ts [--show]
import { readFileSync } from "node:fs";
import { AB } from "./arms";
import { gasFaults, gasMax } from "./gas8";

type J = Record<string, unknown>;
/** Every string a shipped slide shows (text elements, tables), tags stripped; no image data. */
export function slideTexts(lesson: J): string[] {
  const slides = (lesson.slides ?? (lesson.lesson as J)?.slides ?? []) as J[];
  return slides.map((s) => {
    const out: string[] = [];
    const walk = (v: unknown, k = "") => {
      if (k === "src" || k === "source" || k === "notes") return;
      if (typeof v === "string") out.push(v.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "));
      else if (Array.isArray(v)) for (const x of v) walk(x);
      else if (v && typeof v === "object")
        for (const [k2, x] of Object.entries(v as J)) walk(x, k2);
    };
    walk(s.elements);
    return out.join(" \n ");
  });
}

if (import.meta.main) {
  const files = [...new Bun.Glob("*/T/y11-*/lesson.json").scanSync(`${AB}/runs`)].sort();
  let flagged = 0;
  let strict = 0;
  for (const f of files) {
    const texts = slideTexts(JSON.parse(readFileSync(`${AB}/runs/${f}`, "utf8")));
    const hits = gasFaults(texts);
    const run = f.split("/")[0];
    if (hits.length) flagged++;
    const most = gasFaults(texts, "most");
    if (most.length) strict++;
    const lim = gasMax(texts);
    console.log(
      `${run.padEnd(14)} ${hits.length ? (most.length ? "FLAG" : "flag") : "ok  "} max ${lim ? `${Math.floor(lim.vmax)} cm³ (${lim.why})` : "-"}  ${hits.map((h) => `s${h.slide + 1} ${JSON.stringify(h.volumes)}`).join("; ")}`,
    );
    if (process.argv.includes("--show"))
      for (const h of hits) console.log(`    s${h.slide + 1} ${h.fault}`);
  }
  console.log(
    `SUMMARY ${flagged}/${files.length} y11 lessons flagged (rule least, the switch); ${strict}/${files.length} also under rule most (FLAG = certain)`,
  );
}
