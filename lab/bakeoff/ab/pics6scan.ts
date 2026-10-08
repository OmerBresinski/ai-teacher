// faults-3-6-8 #6 ($0): the three pics6 rules re-scored over every saved A/B run.
//  orphan6: each fit repair in repair.jsonl that moved words off a pictured slide;
//  match6: each shipped picture whose writer must_see lists several things (from main.json);
//  stage6: each library reuse whose request names an age, stage or sex.
// bun lab/bakeoff/ab/pics6scan.ts [runGlob]
import { existsSync, readFileSync } from "node:fs";
import { AB } from "./arms";
import { isStageText, orphansAfterFit, unmatchedItems } from "./pics6";
import { seenOf } from "./stage2";

type J = Record<string, unknown>;
const glob = process.argv[2] ?? "*";
const dirs = [...new Bun.Glob(`${glob}/T/*/lesson.json`).scanSync(`${AB}/runs`)]
  .sort()
  .map((f) => `${AB}/runs/${f.replace(/\/lesson\.json$/, "")}`);
const lines = (f: string) =>
  existsSync(f)
    ? readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as J)
    : [];
const tag = (d: string) => d.slice(AB.length + 6).replace("/T/", " ");

let fits = 0;
let orphanHits = 0;
let multi = 0;
let unmatchedHits = 0;
let reuses = 0;
let stageReuses = 0;
for (const d of dirs) {
  // orphan6
  for (const r of lines(`${d}/repair.jsonl`)) {
    const out = r.out as { slide?: J; to_notes?: unknown } | undefined;
    if (r.mode !== "fit" || !out?.slide) continue;
    const moved = (Array.isArray(out.to_notes) ? out.to_notes : [out.to_notes ?? ""]).map(String);
    if (!(out.slide.picture && moved.some((x) => x.trim()))) continue;
    fits++;
    const o = orphansAfterFit(out.slide, moved);
    if (o.length) {
      orphanHits++;
      console.log(`orphan6 ${tag(d)} s${r.slide}: drops picture, orphaned ${JSON.stringify(o)}`);
    }
  }
  // match6: writer pictures by request text ([shows, ...must_see].join(". "))
  const want = new Map<string, string[]>();
  try {
    const w = JSON.parse(String((JSON.parse(readFileSync(`${d}/main.json`, "utf8")) as J).text));
    const visit = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") {
        const o = v as J;
        if (typeof o.shows === "string" && Array.isArray(o.must_see))
          want.set([o.shows, ...o.must_see].join(". "), o.must_see.map(String));
        Object.values(o).forEach(visit);
      }
    };
    visit(w);
  } catch {}
  const lesson = JSON.parse(readFileSync(`${d}/lesson.json`, "utf8")) as J;
  const slides = (lesson.slides ?? (lesson.lesson as J)?.slides ?? []) as J[];
  slides.forEach((s, i) => {
    for (const e of (s.elements ?? []) as J[]) {
      if (e.type !== "image" || typeof e.request !== "string") continue;
      const ms = want.get(e.request);
      if (!ms || ms.length < 2) continue;
      multi++;
      const u = unmatchedItems(ms, seenOf(e as never));
      if (u.length) {
        unmatchedHits++;
        console.log(
          `match6 ${tag(d)} s${i + 1}: ${ms.length - u.length}/${ms.length} seen, drops; unmatched ${JSON.stringify(u)}`,
        );
      }
    }
  });
  // stage6
  const shows = new Map<string, string>();
  for (const e of lines(`${d}/log.jsonl`)) {
    if (e.ev === "picture-start") shows.set(String(e.key), String(e.shows ?? ""));
    if (e.ev === "picture-outcome" && e.via === "library") {
      reuses++;
      const t = shows.get(String(e.key)) ?? "";
      if (isStageText(t)) {
        stageReuses++;
        console.log(`stage6 ${tag(d)} ${e.key}: reuse refused for "${t.slice(0, 90)}"`);
      }
    }
  }
}
console.log(
  `SUMMARY lessons ${dirs.length}; orphan6 ${orphanHits}/${fits} fit repairs on pictured slides; match6 ${unmatchedHits}/${multi} several-thing pictures; stage6 ${stageReuses}/${reuses} library reuses`,
);
