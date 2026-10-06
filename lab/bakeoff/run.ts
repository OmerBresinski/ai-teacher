// BAKEOFF runner: one arm on one or more briefs -> BAKEOFF/runs/<arm>/<brief>/ (lesson, render, timings, cost, log).
// Usage: bun lab/bakeoff/run.ts --arm T --cap 0.25 [--pg 5616] [--out <runsDir>] [--replay <main.txt>]
//        [--no-visuals] [--no-notes] [--no-repair] [--no-render] <brief-id> [...]
// Keys are read from ~/.dayback-openai-key and ~/.dayback-pexels-key (never printed).
import { existsSync, readFileSync } from "node:fs";
import { armT } from "./arm-t";
import { type ArmPlugin, type Brief, runLesson } from "./harness";
import { renderLesson } from "./render";
import { BAKEOFF } from "./services";

/** Arms register here; K and R add theirs on their branches. */
export const ARMS: Record<string, ArmPlugin> = { T: armT };

const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const opt = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const VALUED = new Set([
  "--arm",
  "--cap",
  "--pg",
  "--out",
  "--replay",
  "--bank-cap",
  "--reuse-visuals",
  "--replay-repair",
]);
const briefs = args.filter((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1] ?? ""));
const arm = ARMS[opt("--arm", "T") as string];
if (!arm) throw new Error(`no arm ${opt("--arm")}; have ${Object.keys(ARMS).join(", ")}`);
const cap = Number(opt("--cap", "0.25"));
const runs = opt("--out", `${BAKEOFF}/runs`) as string;
for (const id of briefs) {
  const bf = `${BAKEOFF}/briefs/${id}.json`;
  if (!existsSync(bf)) throw new Error(`no brief ${bf}`);
  const brief = JSON.parse(readFileSync(bf, "utf8")) as Brief;
  const outDir = `${runs}/${arm.id}/${id}`;
  if (existsSync(`${outDir}/lesson.json`)) {
    console.log(`SKIP ${id}: ${outDir} exists (use a fresh --out)`);
    continue;
  }
  const r = await runLesson({
    arm,
    brief,
    outDir,
    capUsd: cap,
    pgPort: Number(opt("--pg", "5616")),
    replay: opt("--replay"),
    noVisuals: flag("--no-visuals"),
    ...(opt("--reuse-visuals") ? { reuseVisuals: opt("--reuse-visuals") } : {}),
    noNotes: flag("--no-notes"),
    noRepair: flag("--no-repair"),
    ...(opt("--replay-repair") ? { replayRepair: opt("--replay-repair") } : {}),
    modelTheme: flag("--model-theme"),
    ...(opt("--bank-cap") ? { bankCapUsd: Number(opt("--bank-cap")) } : {}),
  });
  console.log(
    id,
    JSON.stringify({
      timings: r.timings,
      cost: r.cost,
      failing: r.checks.filter((c) => c.faults.length).length,
    }),
  );
  if (!flag("--no-render")) console.log("rendered", await renderLesson(r.lessonFile));
}
process.exit(0);
