#!/usr/bin/env bun
// bun packages/generation/eval/replay-r3-later.ts [results-dir ...]
//
// Lab r3 (tested-not-taught): replays `laterQuestionsFor` over the saved lab runs' facts, no model
// calls. Defaults: the round-1 runs (`r1-*-L`, `r1b-*-L`, r1m worktree) and the round-2 runs
// (`r2-*-L`, r2m worktree). Prints one row per deck: teaching slides, how many get
// `laterQuestions`, the average count over those that do, and the total.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Lesson } from "@tj/domain/documents";
import { laterQuestionsFor } from "../src/lab/later-questions";

const scratch = join(import.meta.dir, "../../../..");
const roots =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [
        join(scratch, "r1m/packages/generation/eval/results/lab"),
        join(scratch, "r2m/packages/generation/eval/results/lab"),
      ];
const TEACHING = new Set(["content", "image-text", "worked-example"]);

console.log("| run | teaching slides | with laterQuestions | avg count (with) | total |");
console.log("|---|---|---|---|---|");
let teachingAll = 0;
let withAll = 0;
let countAll = 0;
for (const root of roots) {
  const runs = (await readdir(root)).filter((d) => /^r[12]b?-.*-L$/.test(d)).sort();
  for (const run of runs) {
    const file = Bun.file(join(root, run, "lesson.json"));
    if (!(await file.exists())) continue;
    const lesson = JSON.parse(await file.text()) as Lesson;
    const facts = lesson.facts;
    if (!facts) continue;
    let teaching = 0;
    let withLater = 0;
    let count = 0;
    facts.outline.forEach((entry, i) => {
      if (!TEACHING.has(entry.kind)) return;
      teaching += 1;
      const later = laterQuestionsFor(facts, i, lesson.id);
      if (!later) return;
      withLater += 1;
      count += later.length;
    });
    teachingAll += teaching;
    withAll += withLater;
    countAll += count;
    const avg = withLater > 0 ? (count / withLater).toFixed(2) : "-";
    console.log(`| ${run} | ${teaching} | ${withLater} | ${avg} | ${count} |`);
  }
}
const avgAll = withAll > 0 ? (countAll / withAll).toFixed(2) : "-";
console.log(`| **all** | ${teachingAll} | ${withAll} | ${avgAll} | ${countAll} |`);
